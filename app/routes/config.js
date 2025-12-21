// app/routes/config.js
//
// GET /api/config
// Exposes only UI-relevant configuration (no secrets).

import { CONFIG } from "../config.js";

export function registerConfigRoutes(app) {
  app.get("/api/config", (_req, res) => {
    res.json({
      platform: CONFIG.platform,
      supported: CONFIG.supported,
      unsupportedReason: CONFIG.unsupportedReason,

      targetRoot: CONFIG.targetRoot,
      volumeRoots: CONFIG.volumeRoots,

      allowedCameras: CONFIG.allowedCameras,
      dcimFolder: CONFIG.dcimFolder,

      sessionGapMinutes: CONFIG.sessionGapMinutes,
      previewCacheDir: CONFIG.previewCacheDir,
    });
  });
}