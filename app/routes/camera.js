// app/routes/camera.js
//
// Responsibilities:
// - GET /api/camera: return current camera connection state
// - Keep response shape stable for the frontend poller
//
// Response (200):
//   { connected: boolean, label: string, mountPoint?: string, dcimPath?: string }
// Response (500):
//   { connected: false, error: string, details: { message, code } }

import { detectCamera } from "../lib/camera.js";

function pickErrCode(err) {
  return err?.code || err?.cause?.code || "CAMERA_ROUTE_ERROR";
}

export function registerCameraRoutes(app) {
  app.get("/api/camera", async (_req, res) => {
    try {
      const cam = await detectCamera();

      if (!cam) {
        return res.json({ connected: false, label: "" });
      }

      return res.json({
        connected: true,
        label: cam.label,
        mountPoint: cam.mountPoint,
        dcimPath: cam.dcimPath,
      });
    } catch (err) {
      const code = pickErrCode(err);

      // Important: keep "connected:false" so the UI behaves consistently
      return res.status(500).json({
        connected: false,
        error: "camera detect failed",
        details: {
          message: String(err?.message || err),
          code,
        },
      });
    }
  });
}