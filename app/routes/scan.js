// routes/scan.js
//
// Responsibilities:
// - Expose scan progress for UI polling (/api/scan/progress)
// - Scan the camera DCIM filesystem for supported files
// - Extract timestamps (EXIF or fallback) for each file
// - Return BOTH:
//   - raw items: [{ path, ts }] (for client-side regrouping via gap slider)
//   - grouped sessions (server default gap) for immediate initial UI render
//
// Notes:
// - Progress is updated incrementally while EXIF is read.
// - items are always returned sorted ascending by ts.

import { detectCamera } from "../lib/camera.js";
import { walk, getDateTime } from "../lib/scan.js";
import { groupSessions } from "../lib/sessions.js";
import { CONFIG } from "../config.js";
import { getScanProgress, setScanProgress, resetScanProgress } from "../lib/progress.js";

function fail(res, status, payload) {
  return res.status(status).json(payload);
}

export function registerScanRoutes(app) {
  /* --------------------------------------------------------------
   * Progress endpoint (polled by frontend)
   * -------------------------------------------------------------- */
  app.get("/api/scan/progress", (_req, res) => {
    res.json(getScanProgress());
  });

  /* --------------------------------------------------------------
   * Scan endpoint
   * -------------------------------------------------------------- */
  app.post("/api/scan", async (_req, res) => {
    resetScanProgress();

    try {
      // 1) Detect camera mount and profile (allowed extension set comes from profile)
      const cam = await detectCamera();
      if (!cam) {
        setScanProgress({ active: false, message: "No camera detected" });
        return fail(res, 404, { error: "No camera detected" });
      }

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
        const dt = await getDateTime(filePath);
        items.push({ path: filePath, ts: dt.getTime() });
        setScanProgress({ current: items.length });
      }

      // 4) Sort ascending once (stable input for grouping + slider regrouping)
      items.sort((a, b) => a.ts - b.ts);

      // 5) Group using server default gap (front-end may regroup using slider)
      const sessions = groupSessions(items, CONFIG.sessionGapMinutes);

      setScanProgress({ active: false, message: "" });

      return res.json({
        camera: cam.label,
        items,    // frontend source-of-truth for slider regrouping
        sessions, // initial/default grouping
      });
    } catch (err) {
      setScanProgress({ active: false, message: "" });
      return fail(res, 500, { error: String(err) });
    }
  });
}