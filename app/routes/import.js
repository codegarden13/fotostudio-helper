/**
 * routes/import.js: Import API Route (Server-Side)
 *
 * POST /api/import
 *
 * Creates a stable archive structure under CONFIG.targetRoot:
 *   <targetRoot>/<YYYY>/<MM>/<YYYY-MM-DD title__camera>/{originals,exports}
 *
 * Additionally creates a parallel empty folder:
 *   .../exports/<sessionFolderName>/
 *
 * Copies session files idempotently into /originals, prefixing filenames with camera label:
 *   <camera>__<originalName>
 *
 * Writes:
 *   - .import.log   (human readable)
 *   - session.json  (machine readable; includes optional sessionNote/sessionEnd)
 */

import os from "os";
import path from "path";
import fsp from "fs/promises";

import { CONFIG } from "../config.js";
import { safeName } from "../lib/fsutil.js";
import { detectCamera } from "../lib/camera.js";
import {
  assertWritableRoot,
  buildSessionFolders,
  ensureSessionFolders,
  copyFileEnsured,
} from "../lib/import.js";
import { log } from "console";

/* ======================================================
   Errors / validation helpers
====================================================== */

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = "BAD_REQUEST";
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
  if (value == null) return null;

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw badRequest(`Invalid ${label}`);
  return d.getTime();
}

function asStringArray(v) {
  return Array.isArray(v) ? v.map((x) => String(x || "").trim()).filter(Boolean) : [];
}

function asOptionalString(v, { maxLen = 4000 } = {}) {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return "";
  return s.slice(0, maxLen);
}

function requireSupportedPlatform() {
  const platform = os.platform();
  if (platform !== "darwin" && platform !== "linux") {
    throw notSupported(`Import not supported on this platform: ${platform} (supported: darwin, linux)`);
  }
  return platform;
}

function requireDetectedCamera(cam) {
  if (!cam?.label) {
    const err = new Error("No camera detected");
    err.code = "NO_CAMERA";
    err.status = 404;
    throw err;
  }
  return cam;
}

/* ======================================================
   Naming helpers
====================================================== */

function cameraSuffix(label) {
  return safeName(String(label || "").trim());
}

function withCameraPrefix(filename, cameraLabel) {
  const base = String(filename || "");
  const cam = String(cameraLabel || "").trim();
  if (!cam) return base;

  const prefix = `${cam}__`;
  return base.startsWith(prefix) ? base : prefix + base;
}

/* ======================================================
   Payload normalization (now includes sessionEnd + sessionNote)
====================================================== */

function parseKeywords(input) {
  // Accept either:
  // - comma-separated string: "kunde:meier, vogel, projekt:herbst"
  // - array: ["kunde:meier", "vogel"]
  const raw =
    Array.isArray(input) ? input :
      typeof input === "string" ? input.split(",") :
        [];

  const seen = new Set();
  const out = [];

  for (const v of raw) {
    const s = String(v ?? "").trim();
    if (!s) continue;

    // normalize whitespace
    const norm = s.replace(/\s+/g, " ");

    // de-dupe (case-insensitive, but preserve original casing in output)
    const key = norm.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push(norm);
  }

  return out;
}

function normalizeImportPayload(body) {
  const b = body || {};

  // 1) Raw user input (kept for logs/UI, not required in session.json)
  const sessionTitle = String(b.sessionTitle ?? "").trim();
  const sessionNote = String(b.sessionNote ?? "").trim();

  // Accept:
  // - string: "kunde:meier, vogel"
  // - array: ["kunde:meier", "vogel"]
  const sessionKeywords = parseKeywords(b.sessionKeywords);

  // 2) Required time + files
  const sessionStart = b.sessionStart;
  const sessionEnd = b.sessionEnd;

  const files = asStringArray(b.files);

  if (!files.length) throw badRequest("No files");
  if (!sessionStart) throw badRequest("Missing sessionStart (first image timestamp)");

  const firstImageTs = toTsMs(sessionStart, "sessionStart");
  const lastImageTs = sessionEnd ? toTsMs(sessionEnd, "sessionEnd") : null;

  // 3) Folder-safe title (single source of truth for sessionDir naming)
  const title = safeName(sessionTitle).trim() || "Untitled";

  return {
    // client-visible / logging-friendly
    sessionTitle,

    // canonical, sanitized (used for folders + session.json "title")
    title,

    // timestamps
    firstImageTs,
    lastImageTs,

    // metadata
    sessionNote,
    sessionKeywords, // always array

    // files
    files,
  };
}

/* ======================================================
   Copy
====================================================== */

async function copyOriginals({ files, originalsDir, cameraLabel }) {
  const sorted = [...files].sort();
  let copied = 0;
  let skipped = 0;

  // also return mapping for session.json
  const fileMap = [];

  for (const src of sorted) {
    const originalName = path.basename(src);
    const destName = withCameraPrefix(originalName, cameraLabel);
    const dst = path.join(originalsDir, destName);

    const { copied: didCopy } = await copyFileEnsured(src, dst);
    if (didCopy) copied++;
    else skipped++;

    fileMap.push({
      src,
      dstName: destName,
      dstRel: path.posix.join("originals", destName),
    });
  }

  return { copied, skipped, fileMap };
}

/* ======================================================
   Export folder creation (exports/<sessionFolderName>/)
====================================================== */

async function ensureExportSessionFolder(folders) {
  // Ensure base exportsDir exists
  await fsp.mkdir(folders.exportsDir, { recursive: true });

  const sessionFolderName = path.basename(folders.sessionDir);
  const exportSessionDir = path.join(folders.exportsDir, sessionFolderName);

  await fsp.mkdir(exportSessionDir, { recursive: true });

  // Verify
  await fsp.stat(exportSessionDir);

  return exportSessionDir;
}

/* ======================================================
   session.json (machine-readable session metadata)
====================================================== */

async function writeSessionJson({
  sessionJsonFile,
  payload,
  cameraLabel,
  folders,
  exportSessionDir,
  targetRoot,
  fileMap,
}) {
  const keywords = Array.isArray(payload.sessionKeywords)
    ? payload.sessionKeywords
    : [];

  const doc = {
    schema: "studio-helper.session.v1",
    createdAt: new Date().toISOString(),

    camera: cameraLabel || null,

    // Canonical title only (no titleRaw)
    title: payload.title,

    sessionStart: payload.firstImageTs,
    sessionEnd: payload.lastImageTs ?? null,

    // Session-wide metadata
    note: payload.sessionNote || "",   // ✅ FIXED
    keywords,                          // ✅ present even if []

    targetRoot,
    sessionDir: folders.sessionDir,
    originalsDir: folders.originalsDir,
    exportsDir: folders.exportsDir,
    exportSessionDir,

    files: Array.isArray(fileMap) ? fileMap : [],
  };

  await fsp.writeFile(sessionJsonFile, JSON.stringify(doc, null, 2) + "\n", "utf8");
}

/* ======================================================
   .import.log (human-readable)
====================================================== */

async function writeImportLog({
  logFile,
  platform,
  cameraLabel,
  targetRoot,
  folders,
  exportSessionDir,
  payload,
  copied,
  skipped,
}) {
  const note =
    payload?.sessionNoteRaw
      ? payload.sessionNoteRaw.replace(/\s+/g, " ").trim()
      : "";

  const keywordsArr = Array.isArray(payload?.sessionKeywords) ? payload.sessionKeywords : [];
  const keywordsLine = keywordsArr.length ? keywordsArr.join(", ") : "-";

  const lines = [];
  lines.push(`IMPORT START   ${new Date().toISOString()}`);
  lines.push(`platform:      ${platform}`);
  lines.push(`camera:        ${cameraLabel || "-"}`);
  lines.push(`targetRoot:    ${targetRoot}`);
  lines.push(`sessionDir:    ${folders.sessionDir}`);
  lines.push(`originalsDir:  ${folders.originalsDir}`);
  lines.push(`exportsDir:    ${folders.exportsDir}`);
  lines.push(`exportSessDir: ${exportSessionDir}`);

  // ✅ log title from normalized payload
  lines.push(`sessionTitle:  ${payload?.sessionTitleRaw || payload?.title || "-"}`);

  lines.push(`sessionStart:  ${new Date(payload.firstImageTs).toISOString()}`);
  lines.push(`sessionEnd:    ${payload.lastImageTs ? new Date(payload.lastImageTs).toISOString() : "-"}`);

  // ✅ log note + keywords
  lines.push(`sessionNote:   ${note ? note.slice(0, 140) : "-"}`);
  lines.push(`keywords:      ${keywordsLine}`);
  lines.push("");

  lines.push(`RESULT copied=${copied} skipped=${skipped}`);
  lines.push(`IMPORT END     ${new Date().toISOString()}`);

  await fsp.writeFile(logFile, `${lines.join("\n")}\n`, "utf8");
}

/* ======================================================
   Error mapping
====================================================== */

function sendImportError(res, err) {
  const code = err?.code || err?.cause?.code;

  const status =
    Number.isInteger(err?.status) ? err.status :
      code === "NOT_SUPPORTED" ? 501 :
        code === "NOT_WRITABLE" || code === "EACCES" ? 403 :
          code === "ROOT_NOT_FOUND" ? 409 :
            code === "NO_CAMERA" ? 404 :
              code === "ENOENT" ? 409 :
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
    log("[IMPORT] request received", {
      fileCount: Array.isArray(req.body?.files) ? req.body.files.length : 0,
      targetRoot: CONFIG.targetRoot,
    });



    try {
      const platform = requireSupportedPlatform();

      const cam = requireDetectedCamera(await detectCamera());
      const cameraLabel = cam.label;

      const payload = normalizeImportPayload(req.body);

      const targetRoot = await assertWritableRoot(CONFIG.targetRoot);

      const sessionTitleWithCamera =
        `${payload.title}__${cameraSuffix(cameraLabel)}`.trim();

      const folders = buildSessionFolders({
        targetRoot,
        firstImageTs: payload.firstImageTs,
        title: sessionTitleWithCamera,
      });

      // Create base folders: sessionDir + originals + exports
      await ensureSessionFolders(folders);

      // Create exports/<sessionName>/
      const exportSessionDir = await ensureExportSessionFolder(folders);

      // Copy originals
      const result = await copyOriginals({
        files: payload.files,
        originalsDir: folders.originalsDir,
        cameraLabel,
      });

      // Write session.json
      const sessionJsonFile = path.join(folders.sessionDir, "session.json");
      await writeSessionJson({
        sessionJsonFile,
        payload,
        cameraLabel,
        folders,
        exportSessionDir,
        targetRoot,
        fileMap: result.fileMap,
      });

      // Write .import.log
      const logFile = path.join(folders.sessionDir, ".import.log");

      await writeImportLog({
        logFile,
        platform,
        cameraLabel,
        targetRoot,
        folders,
        exportSessionDir,
        payload, // contains: sessionTitle, firstImageTs, lastImageTs, sessionNote, sessionKeywords, files
        copied: result.copied,
        skipped: result.skipped,
      });

      return res.json({
        ok: true,
        platform,
        camera: cameraLabel,
        targetRoot,
        sessionDir: folders.sessionDir,
        originalsDir: folders.originalsDir,
        exportsDir: folders.exportsDir,
        exportSessionDir,
        sessionJsonFile,
        logFile,
        copied: result.copied,
        skipped: result.skipped,
      });
    } catch (err) {
      return sendImportError(res, err);
    }
  });
}