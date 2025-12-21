// routes/scan.js
//
// Responsibilities:
// - GET  /api/scan/progress  (polled by frontend)
// - POST /api/scan
//   - Detect camera + profile
//   - Walk DCIM for supported files
//   - Extract timestamps (EXIF or fallback via getDateTime)
//   - Return:
//     - items:    [{ path, ts }] sorted by ts asc  (frontend source-of-truth for gap slider regrouping)
//     - sessions: server-default grouping for instant initial render
//
// Hardening:
// - Validates camera detection output (prevents ERR_INVALID_ARG_TYPE)
// - Returns helpful 4xx for “not mounted / not supported”
// - Keeps progress state consistent on all exits

import { detectCamera } from "../lib/camera.js";
import { walk, getDateTime } from "../lib/scan.js";
import { groupSessions } from "../lib/sessions.js";
import { CONFIG } from "../config.js";
import { getScanProgress, setScanProgress, resetScanProgress } from "../lib/progress.js";

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

function validateCameraResult(cam) {
  if (!cam) {
    throw httpError(409, "No camera detected (not mounted?)", "CAMERA_NOT_MOUNTED");
  }

  // detectCamera() contract is assumed to provide:
  // { label, dcimPath, profile: { exts: Set } }
  if (!isNonEmptyString(cam.label)) {
    throw httpError(500, "Camera detection returned invalid label", "BAD_CAMERA_LABEL");
  }
  if (!isNonEmptyString(cam.dcimPath)) {
    throw httpError(
      500,
      'Camera detection returned invalid dcimPath (undefined). Check detectCamera() return shape.',
      "BAD_CAMERA_DCIM_PATH"
    );
  }
  if (!cam.profile?.exts || typeof cam.profile.exts.has !== "function") {
    throw httpError(
      500,
      "Camera profile is missing/invalid (extension set not found)",
      "BAD_CAMERA_PROFILE"
    );
  }

  return cam;
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
     Scan endpoint
  ---------------------------- */
  app.post("/api/scan", async (_req, res) => {
    resetScanProgress();

    try {
      ensureSupportedPlatform();

      // 1) Detect camera mount + profile
      setScanProgress({ active: true, current: 0, total: 0, message: "Detecting camera" });
      const cam = validateCameraResult(await detectCamera());

      // 2) Walk DCIM and collect candidate files
      setScanProgress({ active: true, current: 0, total: 0, message: "Finding files" });
      const files = await walk(cam.dcimPath, cam.profile.exts);

      // 3) Read timestamps and update progress
      setScanProgress({
        active: true,
        current: 0,
        total: files.length,
        message: "Reading EXIF",
      });

      const items = [];
      for (const filePath of files) {
        // Defensive: if walk ever yields a non-string, skip it instead of crashing path/fs calls downstream
        if (!isNonEmptyString(filePath)) {
          setScanProgress({ current: items.length });
          continue;
        }

        try {
          const dt = await getDateTime(filePath);
          const ts = dt instanceof Date ? dt.getTime() : Number.NaN;
          if (Number.isFinite(ts)) items.push({ path: filePath, ts });
        } catch {
          // If EXIF fails for a file, skip it (or you could fallback to stat() inside getDateTime)
          // Keep progress moving regardless.
        } finally {
          setScanProgress({ current: items.length });
        }
      }

      // 4) Sort ascending once (stable input for grouping + slider regrouping)
      items.sort((a, b) => a.ts - b.ts);

      // 5) Server default grouping
      const sessions = groupSessions(items, CONFIG.sessionGapMinutes);

      setScanProgress({ active: false, message: "" });

      return res.json({
        camera: cam.label,
        items,
        sessions,
      });
    } catch (err) {
      setScanProgress({ active: false, message: "" });
      return sendError(res, err);
    }
  });
}