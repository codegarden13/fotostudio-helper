// routes/import.js
//
// Responsibilities:
// - POST /api/import
// - Validate + normalize payload
// - Derive per-file camera labels + session camera label (Mixed/Unknown/single)
// - Create archive folder structure under CONFIG.targetRoot
// - Ensure exports/{jpg,tif,jpg-klein}
// - Delegate actual copying (including companions) to lib/import.js
// - Write session.json + .import.log

import os from "os";
import path from "path";
import fsp from "fs/promises";
import { log } from "console";

import { CONFIG } from "../config.js";
import { safeName } from "../lib/fsutil.js";
import { readImageMeta } from "../lib/exif.js";

import {
  assertWritableRoot,
  buildSessionFolders,
  ensureSessionFolders,
  // NOTE: you will extend this function’s signature (see notes below)
  copyOriginalsWithCompanions,
} from "../lib/import.js";

/* ======================================================
   Errors / validation helpers
====================================================== */

function makeErr(message, { status = 500, code = "ERROR", cause } = {}) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  if (cause) err.cause = cause;
  return err;
}

function badRequest(message, code = "BAD_REQUEST") {
  return makeErr(message, { status: 400, code });
}

function notSupported(message) {
  return makeErr(message, { status: 501, code: "NOT_SUPPORTED" });
}

function requireSupportedPlatform() {
  const platform = os.platform();
  if (platform !== "darwin" && platform !== "linux") {
    throw notSupported(
      `Import not supported on this platform: ${platform} (supported: darwin, linux)`
    );
  }
  return platform;
}

function toTsMs(value, label) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (value == null) return null;

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw badRequest(`Invalid ${label}`, "BAD_TIMESTAMP");
  return d.getTime();
}

function asStringArray(v) {
  return Array.isArray(v) ? v.map((x) => String(x || "").trim()).filter(Boolean) : [];
}

function parseKeywords(input) {
  const raw =
    Array.isArray(input) ? input :
      typeof input === "string" ? input.split(",") :
        [];

  const seen = new Set();
  const out = [];

  for (const v of raw) {
    const s = String(v ?? "").trim();
    if (!s) continue;

    const norm = s.replace(/\s+/g, " ");
    const key = norm.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push(norm);
  }
  return out;
}

/* ======================================================
   Payload normalization
====================================================== */

function normalizeImportPayload(body) {
  const b = body || {};

  const sessionTitle = String(b.sessionTitle ?? "").trim();
  const sessionNote = String(b.sessionNote ?? "").trim();
  const sessionKeywords = parseKeywords(b.sessionKeywords);

  const sessionStart = b.sessionStart;
  const sessionEnd = b.sessionEnd;

  const files = asStringArray(b.files);

  if (!files.length) throw badRequest("No files", "NO_FILES");
  if (!sessionStart) throw badRequest("Missing sessionStart (first image timestamp)", "MISSING_SESSION_START");

  const firstImageTs = toTsMs(sessionStart, "sessionStart");
  const lastImageTs = sessionEnd ? toTsMs(sessionEnd, "sessionEnd") : null;

  const title = safeName(sessionTitle).trim() || "Untitled";

  // Optional but strongly recommended for delete/companions scope checks
  const sourceRoot = typeof b.sourceRoot === "string" ? b.sourceRoot.trim() : "";

  return {
    sourceRoot,
    sessionTitle,
    title,
    firstImageTs,
    lastImageTs,
    sessionNote,
    sessionKeywords,
    files,
  };
}

/* ======================================================
   Camera label derivation
====================================================== */

function cameraLabelFromMeta(meta) {
  const make = meta?.cameraMake ? String(meta.cameraMake).trim() : "";
  const model = meta?.cameraModel ? String(meta.cameraModel).trim() : "";
  const label = [make, model].filter(Boolean).join(" ").trim();
  return label || null;
}

function safeCameraToken(label) {
  const s = safeName(String(label || "").trim());
  return s || "Unknown";
}

/**
 * Read camera label for every file (best-effort) and compute session label.
 * Returns:
 * - sessionCameraLabel: "Mixed" | "<label>" | "Unknown"
 * - cameraByPath: Map<absolutePath, labelToken>
 */
async function deriveCameraMapAndSessionLabel(files) {
  const cameraByPath = new Map();
  const sessionDistinct = new Set();

  // sequential is safest for exiftool; you can add limited concurrency later
  for (const file of files || []) {
    let label = null;
    try {
      const meta = await readImageMeta(file);
      label = cameraLabelFromMeta(meta);
    } catch {
      // ignore
    }

    const token = safeCameraToken(label);
    cameraByPath.set(file, token);

    if (token && token !== "Unknown") sessionDistinct.add(token);
    if (sessionDistinct.size > 1) {
      // no need to read everything once mixed is confirmed; BUT
      // keep filling cameraByPath for correctness of per-file prefixes.
      // so: do NOT break here.
    }
  }

  let sessionCameraLabel = "Unknown";
  if (sessionDistinct.size === 1) sessionCameraLabel = [...sessionDistinct][0];
  else if (sessionDistinct.size > 1) sessionCameraLabel = "Mixed";

  return { sessionCameraLabel, cameraByPath };
}

/* ======================================================
   Export folder creation
====================================================== */

async function ensureExportSubfolders(folders) {
  await fsp.mkdir(folders.exportsDir, { recursive: true });

  const exportsJpgDir = path.join(folders.exportsDir, "jpg");
  const exportsTifDir = path.join(folders.exportsDir, "tif");
  const exportsJpgSmallDir = path.join(folders.exportsDir, "jpg-klein");

  await fsp.mkdir(exportsJpgDir, { recursive: true });
  await fsp.mkdir(exportsTifDir, { recursive: true });
  await fsp.mkdir(exportsJpgSmallDir, { recursive: true });

  return { exportsJpgDir, exportsTifDir, exportsJpgSmallDir };
}

/* ======================================================
   session.json
====================================================== */

async function writeSessionJson({
  sessionJsonFile,
  payload,
  sessionCameraLabel,
  folders,
  exportDirs,
  targetRoot,
  fileMap,
}) {
  const doc = {
    schema: "studio-helper.session.v1",
    createdAt: new Date().toISOString(),

    camera: sessionCameraLabel || null,
    title: payload.title,

    sessionStart: payload.firstImageTs,
    sessionEnd: payload.lastImageTs ?? null,

    note: payload.sessionNote || "",
    keywords: Array.isArray(payload.sessionKeywords) ? payload.sessionKeywords : [],

    sourceRoot: payload.sourceRoot || null,

    targetRoot,
    sessionDir: folders.sessionDir,
    originalsDir: folders.originalsDir,
    exportsDir: folders.exportsDir,
    exports: {
      jpg: exportDirs.exportsJpgDir,
      tif: exportDirs.exportsTifDir,
      jpgSmall: exportDirs.exportsJpgSmallDir,
    },

    files: Array.isArray(fileMap) ? fileMap : [],
  };

  await fsp.writeFile(sessionJsonFile, JSON.stringify(doc, null, 2) + "\n", "utf8");
}

/* ======================================================
   .import.log
====================================================== */

async function writeImportLog({
  logFile,
  platform,
  sessionCameraLabel,
  targetRoot,
  folders,
  exportDirs,
  payload,
  copied,
  skipped,
}) {
  const note = (payload?.sessionNote || "").replace(/\s+/g, " ").trim();
  const keywordsArr = Array.isArray(payload?.sessionKeywords) ? payload.sessionKeywords : [];
  const keywordsLine = keywordsArr.length ? keywordsArr.join(", ") : "-";

  const lines = [];
  lines.push(`IMPORT START   ${new Date().toISOString()}`);
  lines.push(`platform:      ${platform}`);
  lines.push(`camera:        ${sessionCameraLabel || "-"}`);
  lines.push(`sourceRoot:    ${payload.sourceRoot || "-"}`);
  lines.push(`targetRoot:    ${targetRoot}`);
  lines.push(`sessionDir:    ${folders.sessionDir}`);
  lines.push(`originalsDir:  ${folders.originalsDir}`);
  lines.push(`exportsDir:    ${folders.exportsDir}`);
  lines.push(`exports/jpg:   ${exportDirs.exportsJpgDir}`);
  lines.push(`exports/tif:   ${exportDirs.exportsTifDir}`);
  lines.push(`exports/jpg-k: ${exportDirs.exportsJpgSmallDir}`);

  lines.push(`sessionTitle:  ${payload?.sessionTitle || payload?.title || "-"}`);
  lines.push(`sessionStart:  ${new Date(payload.firstImageTs).toISOString()}`);
  lines.push(`sessionEnd:    ${payload.lastImageTs ? new Date(payload.lastImageTs).toISOString() : "-"}`);

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
      sourceRoot: req.body?.sourceRoot,
    });

    try {
      const platform = requireSupportedPlatform();
      const payload = normalizeImportPayload(req.body);

      const targetRoot = await assertWritableRoot(CONFIG.targetRoot);

      // Derive per-file camera map (for prefixing) + session label for folder suffix
      const { sessionCameraLabel, cameraByPath } = await deriveCameraMapAndSessionLabel(payload.files);

      // Folder naming: <YYYY-MM-DD title__camera>
      const sessionTitleWithCamera = `${payload.title}__${safeCameraToken(sessionCameraLabel)}`.trim();

      const folders = buildSessionFolders({
        targetRoot,
        firstImageTs: payload.firstImageTs,
        title: sessionTitleWithCamera,
      });

      await ensureSessionFolders(folders);
      const exportDirs = await ensureExportSubfolders(folders);

      // Delegate copy (companions + RAW→exports/jpg routing happens in lib/import.js)
      const result = await copyOriginalsWithCompanions({
        files: payload.files,
        originalsDir: folders.originalsDir,
        exportsDir: folders.exportsDir,
        includeJpegForRaw: true,
      });

      const sessionJsonFile = path.join(folders.sessionDir, "session.json");
      await writeSessionJson({
        sessionJsonFile,
        payload,
        sessionCameraLabel,
        folders,
        exportDirs,
        targetRoot,
        fileMap: result.fileMap || [],
      });

      const logFile = path.join(folders.sessionDir, ".import.log");
      await writeImportLog({
        logFile,
        platform,
        sessionCameraLabel,
        targetRoot,
        folders,
        exportDirs,
        payload,
        copied: result.copied,
        skipped: result.skipped,
      });

      return res.json({
        ok: true,
        platform,
        camera: sessionCameraLabel,
        targetRoot,
        sourceRoot: payload.sourceRoot || null,

        sessionDir: folders.sessionDir,
        originalsDir: folders.originalsDir,
        exportsDir: folders.exportsDir,
        exports: exportDirs,

        sessionJsonFile,
        logFile,
        copied: result.copied,
        skipped: result.skipped,
      });
    } catch (err) {
      log("[IMPORT] failed", { err: String(err?.message || err), code: err?.code });
      return sendImportError(res, err);
    }
  });
}