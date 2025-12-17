import { detectCamera } from "../lib/camera.js";

export function registerCameraRoutes(app) {
  app.get("/api/camera", async (_req, res) => {
    try {
      const cam = await detectCamera();
      if (!cam) return res.json({ connected: false });
      res.json({ connected: true, label: cam.label });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
}