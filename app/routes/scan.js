// routes/scan.js
//
// Responsibilities:
// - GET  /api/scan/progress  (polled by frontend)
// - POST /api/scan
//   - Scan a user-selected sourceRoot (recursive)
//   - Collect candidate image/RAW files by extension
//   - Extract timestamps (EXIF via readImageMeta; fallback via getDateTime)
//   - Return:
//     - items:    [{ path, ts }] sorted by ts asc
//     - sessions: server-default grouping for instant initial render
//
// Hardening:
// - Validates sourceRoot
// - Returns helpful 4xx for missing/invalid paths
// - Keeps progress state consistent on all exits

import path from "path";
import fsp from "fs/promises";

import { walk} from "../lib/fsutil.js";
import { getDateTime } from "../lib/scan.js";
import { readImageMeta } from "../lib/exif.js";
import { groupSessions } from "../lib/sessions.js";
import { CONFIG } from "../config.js";
import {
  getScanProgress,
  setScanProgress,
  resetScanProgress,
} from "../lib/progress.js";

/* ======================================================
   Small utilities
====================================================== */

function isNonEmptyString(x) {
  return typeof x === "string" && x.trim().length > 0;
}

function httpError(status, message, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

function sendError(res, err, fallbackStatus = 500) {
  const status = Number.isInteger(err?.status) ? err.status : fallbackStatus;
  const code = err?.code || err?.cause?.code;
  return res.status(status).json({
    error: String(err?.message || err),
    code,
  });
}

function ensureSupportedPlatform() {
  if (CONFIG.supported === false) {
    throw httpError(
      501,
      CONFIG.unsupportedReason || `Platform not supported: ${CONFIG.platform}`,
      "NOT_SUPPORTED"
    );
  }
}

function normalizeSourceRoot(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (s.includes("\0")) throw httpError(400, "Invalid path", "BAD_PATH");
  return path.resolve(s);
}

async function assertDirectory(p) {
  try {
    const st = await fsp.stat(p);
    if (!st.isDirectory()) throw httpError(400, `Not a directory: ${p}`, "NOT_A_DIRECTORY");
  } catch (e) {
    if (e?.code === "ENOENT") throw httpError(404, `Directory not found: ${p}`, "SOURCE_NOT_FOUND");
    if (e?.code === "EACCES" || e?.code === "EPERM") throw httpError(403, `No access: ${p}`, "SOURCE_FORBIDDEN");
    throw e;
  }
}

// Camera-independent allowed extensions (keep here for now; later move to CONFIG.scanExts)
const ALLOWED_EXTS = new Set([
  ".arw", ".cr2", ".cr3", ".nef", ".raf", ".dng",
  ".rw2", ".orf", ".pef", ".srw",
  ".jpg", ".jpeg",
  ".tif", ".tiff",
  ".heic",
]);

function deriveCameraLabel(meta) {
  const make = meta?.cameraMake ? String(meta.cameraMake).trim() : "";
  const model = meta?.cameraModel ? String(meta.cameraModel).trim() : "";
  const label = [make, model].filter(Boolean).join(" ").trim();
  return label || null;
}

/* ======================================================
   Routes
====================================================== */

export function registerScanRoutes(app) {
  /* ---------------------------
     Progress endpoint
  ---------------------------- */
  app.get("/api/scan/progress", (_req, res) => {
    res.json(getScanProgress());
  });

  /* ---------------------------
     Scan endpoint (source folder, recursive)
  ---------------------------- */
  app.post("/api/scan", async (req, res) => {
    resetScanProgress();

    try {
      ensureSupportedPlatform();

      // 1) Source root (selected by user)
      const sourceRoot = normalizeSourceRoot(req.body?.sourceRoot || CONFIG.sourceRoot);
      if (!sourceRoot) {
        throw httpError(
          400,
          "Missing sourceRoot (select a source folder first)",
          "MISSING_SOURCE_ROOT"
        );
      }

      await assertDirectory(sourceRoot);

      // 2) Walk sourceRoot recursively and collect candidate files
      setScanProgress({ active: true, current: 0, total: 0, message: "Finding files" });

      const files = await walk(sourceRoot, ALLOWED_EXTS, {
        skipDirNames: new Set([".studio-helper-trash"]),
      });

      // 3) Read timestamps + (optional) camera label
      setScanProgress({
        active: true,
        current: 0,
        total: files.length,
        message: "Reading EXIF timestamps",
      });

      const items = [];
      let cameraGuess = null;

      for (let i = 0; i < files.length; i++) {
        const filePath = files[i];

        if (!isNonEmptyString(filePath)) {
          setScanProgress({ current: i + 1 });
          continue;
        }

        try {
          // Prefer rich EXIF meta
          const meta = await readImageMeta(filePath);

          // createdAt is ms epoch (per your refactored exif.js)
          let ts = Number(meta?.createdAt);

          // Fallback: if createdAt missing/invalid, try getDateTime()
          if (!Number.isFinite(ts)) {
            const dt = await getDateTime(filePath);
            ts = dt instanceof Date ? dt.getTime() : Number.NaN;
          }

          if (Number.isFinite(ts)) {
            items.push({ path: filePath, ts });

            // Fill cameraGuess once from first good meta
            if (!cameraGuess) cameraGuess = deriveCameraLabel(meta);
          }
        } catch {
          // Skip unreadable files; keep progress moving
        } finally {
          setScanProgress({ current: i + 1 });
        }
      }

      // 4) Sort ascending (stable input for client grouping)
      items.sort((a, b) => a.ts - b.ts);

      // 5) Server-side default grouping (client still regroups with slider)
      const sessions = groupSessions(items, CONFIG.sessionGapMinutes);

      setScanProgress({ active: false, message: "" });

      return res.json({
        ok: true,
        sourceRoot,
        cameraGuess, // optional (can be null)
        items,
        sessions,
      });
    } catch (err) {
      setScanProgress({ active: false, message: "" });
      return sendError(res, err);
    }
  });
}