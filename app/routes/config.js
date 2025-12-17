import { CONFIG } from "../config.js";

export function registerConfigRoutes(app) {
  app.get("/api/config", (_req, res) => {
    res.json({
      targetRoot: CONFIG.targetRoot,
      sessionGapMinutes: CONFIG.sessionGapMinutes,
      allowedCameras: CONFIG.allowedCameras,
    });
  });
}