import { detectCamera } from "../lib/camera.js";
import { walk, getDateTime } from "../lib/scan.js";
import { groupSessions } from "../lib/sessions.js";
import { CONFIG } from "../config.js";
import { getScanProgress, setScanProgress, resetScanProgress } from "../lib/progress.js";

export function registerScanRoutes(app) {
  app.get("/api/scan/progress", (_req, res) => {
    res.json(getScanProgress());
  });

  app.post("/api/scan", async (_req, res) => {
    try {
      const cam = await detectCamera();
      if (!cam) return res.status(404).json({ error: "No camera detected" });

      resetScanProgress();

      const files = await walk(cam.dcimPath, cam.profile.exts);

      setScanProgress({ active: true, current: 0, total: files.length, message: "Reading EXIF" });

      const items = [];
      for (const p of files) {
        const ts = await getDateTime(p);
        items.push({ path: p, ts: ts.getTime() });
        setScanProgress({ current: items.length });
      }

      items.sort((a, b) => a.ts - b.ts);
      const sessions = groupSessions(items, CONFIG.sessionGapMinutes);

      setScanProgress({ active: false });

      res.json({ camera: cam.label, sessions });
    } catch (e) {
      setScanProgress({ active: false });
      res.status(500).json({ error: String(e) });
    }
  });
}