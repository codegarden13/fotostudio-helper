// routes/delete.js
//
// POST /api/delete
// Body: { file: string, sourceRoot: string }
//
// Moves {file + companions} to a CENTRAL trash folder under sourceRoot:
//
//   <sourceRoot>/.studio-helper-trash/<timestamp>/<relative-path-under-sourceRoot>
//
// Guarantees:
// - Everything must be inside sourceRoot
// - Trash is always central (never per-subfolder)
// - Relative paths are preserved to avoid collisions
// - Rename stays atomic (same volume)

import fs from "fs";
import path from "path";
import fsp from "fs/promises";

import { findCompanionsForImage } from "../lib/companions.js";

/* ======================================================
   Error helpers
====================================================== */

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

/* ======================================================
   Path safety + utilities
====================================================== */

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

async function statIsFile(p) {
  try {
    const st = await fsp.stat(p);
    return st.isFile();
  } catch {
    return false;
  }
}

function isoStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/**
 * Central trash directory for this delete request.
 * Kept under sourceRoot so rename() stays atomic.
 */
function makeTrashDir(sourceRootAbs) {
  return path.join(sourceRootAbs, ".studio-helper-trash", isoStamp());
}

/**
 * Move a file into trash, preserving its relative path under sourceRoot.
 *
 * Example:
 *   sourceRootAbs = /Volumes/DISK/INPUT
 *   fileAbs       = /Volumes/DISK/INPUT/2025-06-03/A/DSC1.ARW
 *   =>
 *   trash/.../2025-06-03/A/DSC1.ARW
 */
async function moveToTrashPreserveRel(fileAbs, { sourceRootAbs, trashDirAbs }) {
  const rel = path.relative(sourceRootAbs, fileAbs);

  // Safety: must still be inside sourceRoot
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw httpError(403, "Refusing to trash outside sourceRoot", "OUTSIDE_ROOT");
  }

  let dst = path.join(trashDirAbs, rel);
  await fsp.mkdir(path.dirname(dst), { recursive: true });

  // Collision handling (rare but possible)
  if (fs.existsSync(dst)) {
    const ext = path.extname(dst);
    const base = ext ? dst.slice(0, -ext.length) : dst;
    dst = ext
      ? `${base}-${Date.now()}${ext}`
      : `${base}-${Date.now()}`;
  }

  await fsp.rename(fileAbs, dst);
  return dst;
}

/* ======================================================
   Route registration
====================================================== */

export function registerDeleteRoutes(app) {
  app.post("/api/delete", async (req, res) => {
    try {
      // 1) Validate input
      const absFile = normalizeAbs(req.body?.file);
      const absRoot = normalizeAbs(req.body?.sourceRoot);

      if (!absFile) throw httpError(400, "file missing", "MISSING_FILE");
      if (!absRoot) throw httpError(400, "sourceRoot missing", "MISSING_SOURCE_ROOT");

      if (!isPathInside(absFile, absRoot)) {
        throw httpError(
          403,
          `Refusing to delete outside allowed root: ${absRoot}`,
          "OUTSIDE_ROOT"
        );
      }

      if (!(await statIsFile(absFile))) {
        throw httpError(404, "File not found", "NOT_FOUND");
      }

      // 2) Discover companions (best-effort)
      const companions = await findCompanionsForImage(absFile, {
        includeJpegForRaw: true,
      });

      // Primary + companions, normalized & safety-filtered
      const targets = new Set(
        [absFile, ...companions]
          .map(normalizeAbs)
          .filter((p) => p && isPathInside(p, absRoot))
      );

      // 3) One trash dir per request
      const trashDir = makeTrashDir(absRoot);
      await fsp.mkdir(trashDir, { recursive: true });

      const moved = [];
      const skipped = [];
      const errors = [];

      // 4) Move files
      for (const p of targets) {
        try {
          if (!(await statIsFile(p))) {
            skipped.push({ path: p, reason: "not-a-file-or-missing" });
            continue;
          }

          const dst = await moveToTrashPreserveRel(p, {
            sourceRootAbs: absRoot,
            trashDirAbs: trashDir,
          });

          moved.push({ from: p, to: dst });
        } catch (e) {
          errors.push({ path: p, error: String(e?.message || e) });
        }
      }

      return res.json({
        ok: true,
        sourceRoot: absRoot,
        trashedTo: trashDir,
        movedCount: moved.length,
        moved,
        skipped,
        errors,
      });
    } catch (err) {
      return sendDeleteError(res, err);
    }
  });
}