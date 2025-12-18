// app/routes/config.js
import { CONFIG } from "../config.js";

export function registerConfigRoutes(app) {
  if (!app) throw new Error("registerConfigRoutes(app): app is required");

  app.get("/api/config", (_req, res) => {
    res.json({
      targetRoot: CONFIG.targetRoot,
      sessionGapMinutes: CONFIG.sessionGapMinutes,
      allowedCameras: CONFIG.allowedCameras,
    });
  });
}