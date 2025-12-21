// routes/import.js
//
// Responsibilities:
// - POST /api/import
// - Validate payload
// - Treat CONFIG.targetRoot as an existing mount (do NOT mkdir it)
// - Create YYYY/MM/YYYY-MM-DD <title>/{originals,exports}
// - Copy files into /originals (idempotent; skip if already exists)
// - Write an import log into the session folder

import os from "os";
import path from "path";
import fsp from "fs/promises";

import { CONFIG } from "../config.js";
import { safeName } from "../lib/fsutil.js";
import {
  assertWritableRoot,
  buildSessionFolders,
  ensureSessionFolders,
  copyFileEnsured,
} from "../lib/import.js";

/* ======================================================
   Helpers
====================================================== */

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function notSupported(message) {
  const err = new Error(message);
  err.code = "NOT_SUPPORTED";
  err.status = 501;
  return err;
}

function toTsMs(value, label) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw badRequest(`Invalid ${label}`);
  return d.getTime();
}

function asStringArray(v) {
  return Array.isArray(v) ? v.map((x) => String(x || "").trim()).filter(Boolean) : [];
}

function requireSupportedPlatform() {
  const platform = os.platform(); // "darwin" | "linux" | "win32" | ...
  if (platform !== "darwin" && platform !== "linux") {
    throw notSupported(
      `Import not supported on this platform: ${platform} (supported: darwin, linux)`
    );
  }
  return platform;
}

/* ======================================================
   Payload normalization
====================================================== */

function normalizeImportPayload(body) {
  const b = body || {};

  const sessionTitleRaw = String(b.sessionTitle || "").trim();
  const sessionStart = b.sessionStart;
  const files = asStringArray(b.files);

  if (!files.length) throw badRequest("No files");
  if (!sessionStart) throw badRequest("Missing sessionStart (first image timestamp)");

  // IMPORTANT: YYYY-MM-DD must come from first image timestamp
  const firstImageTs = toTsMs(sessionStart, "sessionStart");

  // Title is user-provided; safeName prevents traversal/illegal chars
  const title = safeName(sessionTitleRaw).trim() || "Untitled";

  return { sessionTitleRaw, firstImageTs, title, files };
}

/* ======================================================
   Copy + logging
====================================================== */

async function copyOriginals({ files, originalsDir }) {
  const sorted = [...files].sort();

  let copied = 0;
  let skipped = 0;

  for (const src of sorted) {
    const dst = path.join(originalsDir, path.basename(src));
    const { copied: didCopy } = await copyFileEnsured(src, dst);
    if (didCopy) copied++;
    else skipped++;
  }

  return { copied, skipped };
}

async function writeImportLog({
  logFile,
  platform,
  targetRoot,
  folders,
  sessionTitleRaw,
  firstImageTs,
  files,
  copied,
  skipped,
}) {
  const sorted = [...files].sort();

  const lines = [];
  lines.push(`IMPORT START   ${new Date().toISOString()}`);
  lines.push(`platform:      ${platform}`);
  lines.push(`targetRoot:    ${targetRoot}`);
  lines.push(`sessionDir:    ${folders.sessionDir}`);
  lines.push(`originalsDir:  ${folders.originalsDir}`);
  lines.push(`exportsDir:    ${folders.exportsDir}`);
  lines.push(`sessionTitle:  ${sessionTitleRaw}`);
  lines.push(`firstImageTs:  ${new Date(firstImageTs).toISOString()}`);
  lines.push(`fileCount:     ${sorted.length}`);
  lines.push("");

  // Per-file log (useful for debugging; remove if too verbose)
  for (const src of sorted) {
    const dst = path.join(folders.originalsDir, path.basename(src));
    lines.push(`FILE          ${src} -> ${dst}`);
  }

  lines.push("");
  lines.push(`RESULT copied=${copied} skipped=${skipped}`);
  lines.push(`IMPORT END     ${new Date().toISOString()}`);

  await fsp.writeFile(logFile, `${lines.join("\n")}\n`, "utf8");
}

/* ======================================================
   Error mapping (single place)
====================================================== */

function sendImportError(res, err) {
  const code = err?.code || err?.cause?.code;

  // Prefer explicit statuses
  let status =
    Number.isInteger(err?.status) ? err.status :
    code === "NOT_SUPPORTED" ? 501 :
    code === "NOT_WRITABLE" || code === "EACCES" ? 403 :
    code === "ENOENT" ? 409 : // usually "not mounted" in your context
    500;

  return res.status(status).json({
    error: "Import failed",
    details: { error: String(err?.message || err), code },
  });
}

/* ======================================================
   Route registration
====================================================== */

export function registerImportRoutes(app) {
  app.post("/api/import", async (req, res) => {
    try {
      // Mandatory platform gate: macOS + Linux only
      const platform = requireSupportedPlatform();

      // Normalize payload
      const payload = normalizeImportPayload(req.body);

      // Root must exist (mounted) + be writable; do NOT mkdir root
      const targetRoot = await assertWritableRoot(CONFIG.targetRoot);

      // Build + create:
      // /<root>/YYYY/MM/YYYY-MM-DD <title>/{originals,exports}
      const folders = buildSessionFolders({
        targetRoot,
        firstImageTs: payload.firstImageTs,
        title: payload.title,
      });

      await ensureSessionFolders(folders);

      // Copy into originals (idempotent)
      const result = await copyOriginals({
        files: payload.files,
        originalsDir: folders.originalsDir,
      });

      // Write import log into session folder
      const logFile = path.join(folders.sessionDir, ".import.log");
      await writeImportLog({
        logFile,
        platform,
        targetRoot,
        folders,
        sessionTitleRaw: payload.sessionTitleRaw,
        firstImageTs: payload.firstImageTs,
        files: payload.files,
        ...result,
      });

      return res.json({
        ok: true,
        targetRoot,
        sessionDir: folders.sessionDir,
        originalsDir: folders.originalsDir,
        exportsDir: folders.exportsDir,
        logFile,
        copied: result.copied,
        skipped: result.skipped,
      });
    } catch (err) {
      return sendImportError(res, err);
    }
  });
}