// routes/preview.js
import path from "path";
import { extOf } from "../lib/fsutil.js";
import { extractRawPreview } from "../lib/preview.js";

const RAW_EXTS = new Set([
  ".arw", ".dng", ".nef", ".cr2", ".cr3", ".raf", ".rw2", ".orf", ".pef", ".srw"
]);

export function registerPreviewRoutes(app) {
  app.get("/api/preview", async (req, res) => {
    const p = req.query.path;
    if (!p) return res.status(400).send("missing path");

    try {
      const resolved = path.resolve(p);
      const e = extOf(resolved);

      if (RAW_EXTS.has(e)) {
        const jpg = await extractRawPreview(resolved);
        return res.type("jpeg").sendFile(jpg);
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