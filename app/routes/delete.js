// routes/delete.js
//
// - POST /api/delete
// - Moves {file + companions} to ".studio-helper-trash/<timestamp>/"
// - Enforces: everything must be inside sourceRoot

import path from "path";
import fsp from "fs/promises";
import fs from "fs";

import { findCompanionsForImage } from "../lib/companions.js";

/* ---------------------------
   Error helpers
---------------------------- */

function httpError(status, message, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

function sendDeleteError(res, err) {
  const code = err?.code || err?.cause?.code;
  const status =
    Number.isInteger(err?.status) ? err.status :
    code === "ENOENT" ? 404 :
    code === "EACCES" || code === "EPERM" ? 403 :
    500;

  return res.status(status).json({
    error: "Delete failed",
    details: { error: err?.message || String(err), code },
  });
}

/* ---------------------------
   Path safety
---------------------------- */

function normalizeAbs(p) {
  const s = String(p || "").trim();
  if (!s) return "";
  if (s.includes("\0")) throw httpError(400, "Invalid path", "BAD_PATH");
  return path.resolve(s);
}

function isPathInside(childAbs, parentAbs) {
  const rel = path.relative(parentAbs, childAbs);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function trashRootForFile(fileAbs) {
  // keep trash on same volume -> rename stays atomic
  return path.join(path.dirname(fileAbs), ".studio-helper-trash");
}

async function moveToTrash(fileAbs, { trashDir } = {}) {
  const base = path.basename(fileAbs);
  let dst = path.join(trashDir, base);

  if (fs.existsSync(dst)) {
    const ext = path.extname(base);
    const name = path.basename(base, ext);
    dst = path.join(trashDir, `${name}-${Date.now()}${ext}`);
  }

  await fsp.rename(fileAbs, dst);
  return dst;
}

async function statIsFile(p) {
  try {
    const st = await fsp.stat(p);
    return st.isFile();
  } catch {
    return false;
  }
}

/* ---------------------------
   Route registration
---------------------------- */

export function registerDeleteRoutes(app) {
  app.post("/api/delete", async (req, res) => {
    try {
      const file = req.body?.file;
      const sourceRoot = req.body?.sourceRoot;

      if (!file) throw httpError(400, "file missing", "MISSING_FILE");
      if (!sourceRoot) throw httpError(400, "sourceRoot missing", "MISSING_SOURCE_ROOT");

      const absFile = normalizeAbs(file);
      const absRoot = normalizeAbs(sourceRoot);

      // Safety: only inside selected source root
      if (!isPathInside(absFile, absRoot) && absFile !== absRoot) {
        throw httpError(403, `Refusing to delete outside allowed root: ${absRoot}`, "OUTSIDE_ROOT");
      }

      // Main file must exist and be a file
      if (!(await statIsFile(absFile))) throw httpError(404, "File not found", "NOT_FOUND");

      // Discover companions (best-effort)
      const companions = await findCompanionsForImage(absFile, { includeJpegForRaw: true });

      // Build delete set: main file + companions that are also inside root + are files
      const candidates = [absFile, ...companions]
        .map(normalizeAbs)
        .filter((p) => (isPathInside(p, absRoot) || p === absRoot)); // safety for each

      // Create one trash dir for this delete action (keeps files together)
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const trashDir = path.join(trashRootForFile(absFile), stamp);
      await fsp.mkdir(trashDir, { recursive: true });

      const moved = [];
      const skipped = [];
      const errors = [];

      for (const p of candidates) {
        try {
          if (!(await statIsFile(p))) {
            skipped.push({ path: p, reason: "not-a-file-or-missing" });
            continue;
          }
          const dst = await moveToTrash(p, { trashDir });
          moved.push({ from: p, to: dst });
        } catch (e) {
          errors.push({ path: p, error: String(e?.message || e) });
        }
      }

      return res.json({
        ok: true,
        sourceRoot: absRoot,
        trashedTo: trashDir,
        moved,
        skipped,
        errors,
      });
    } catch (err) {
      return sendDeleteError(res, err);
    }
  });
}