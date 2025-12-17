import path from "path";
import { extOf } from "../lib/fsutil.js";
import { extractArwPreview } from "../lib/preview.js";

export function registerPreviewRoutes(app) {
  app.get("/api/preview", async (req, res) => {
    const p = req.query.path;
    if (!p) return res.status(400).send("missing path");

    try {
      const resolved = path.resolve(p);
      const e = extOf(resolved);

      if (e === ".arw") {
        const jpg = await extractArwPreview(resolved);
        return res.sendFile(jpg);
      }

      if (e === ".jpg" || e === ".jpeg") {
        return res.sendFile(resolved);
      }

      return res.status(415).send("Preview not supported");
    } catch (err) {
      console.error("Preview error:", err);
      return res.status(500).send(String(err));
    }
  });
}