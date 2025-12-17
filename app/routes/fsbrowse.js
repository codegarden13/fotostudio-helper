// routes/fsbrowse.js
import fs from "fs/promises";
import path from "path";

export function registerFsBrowseRoutes(app) {
  app.get("/api/fs/browse", async (req, res) => {
    try {
      const basePath = req.query.path || "/";

      const entries = await fs.readdir(basePath, { withFileTypes: true });

      const dirs = entries
        .filter(e => e.isDirectory())
        .map(e => ({
          name: e.name,
          path: path.join(basePath, e.name)
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      res.json({
        path: basePath,
        parent: path.dirname(basePath),
        directories: dirs
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
}