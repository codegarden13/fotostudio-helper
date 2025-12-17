import path from "path";
import { CONFIG } from "../config.js";
import { safeName } from "../lib/fsutil.js";
import { copyFileEnsured } from "../lib/import.js";

export function registerImportRoutes(app) {
  app.post("/api/import", async (req, res) => {
    const { sessionTitle, sessionStart, files } = req.body || {};
    if (!files?.length) return res.status(400).json({ error: "No files" });

    try {
      const title = safeName(sessionTitle);
      const start = new Date(sessionStart);

      const folder =
        `${start.getFullYear()}-` +
        `${String(start.getMonth() + 1).padStart(2, "0")}-` +
        `${String(start.getDate()).padStart(2, "0")} ` +
        title;

      const destDir = path.join(CONFIG.targetRoot, folder);

      for (const src of files) {
        const dst = path.join(destDir, path.basename(src));
        await copyFileEnsured(src, dst);
      }

      res.json({ ok: true, destDir });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });
}