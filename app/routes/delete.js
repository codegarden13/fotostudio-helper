import path from "path";
import fsp from "fs/promises";

import { detectCamera } from "../lib/camera.js";
import { extOf, exists } from "../lib/fsutil.js";

function isPathInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

async function moveToCameraTrash(cam, absPath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const trashRoot = path.join(cam.mountPoint, ".studio-helper-trash", stamp);
  await fsp.mkdir(trashRoot, { recursive: true });

  const base = path.basename(absPath);
  let dst = path.join(trashRoot, base);

  if (await exists(dst)) {
    const ext = path.extname(base);
    const name = path.basename(base, ext);
    dst = path.join(trashRoot, `${name}-${Date.now()}${ext}`);
  }

  await fsp.rename(absPath, dst);
  return dst;
}

export function registerDeleteRoutes(app) {
  app.post("/api/delete", async (req, res) => {
    try {
      const { file } = req.body || {};
      if (!file) return res.status(400).json({ error: "file missing" });

      const cam = await detectCamera();
      if (!cam) return res.status(404).json({ error: "No camera detected" });

      const abs = path.resolve(file);

      // Only allow deletion inside camera DCIM
      if (!isPathInside(abs, cam.dcimPath)) {
        return res.status(403).json({ error: "Refusing to delete outside camera DCIM" });
      }

      // Only allow file types for this camera profile
      const e = extOf(abs);
      if (!cam.profile.exts.has(e)) {
        return res.status(415).json({ error: `Not allowed for this camera profile: ${e}` });
      }

      // Ensure file exists and is a file
      let st;
      try {
        st = await fsp.stat(abs);
      } catch {
        return res.status(404).json({ error: "File not found" });
      }
      if (!st.isFile()) return res.status(400).json({ error: "Not a file" });

      const movedTo = await moveToCameraTrash(cam, abs);
      res.json({ ok: true, movedTo });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
}