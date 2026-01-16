// routes/delete-photoSession.js
//
// POST /api/delete-session
// Body: { sourceRoot: string, files: string[] }
//
// Moves each primary file plus companions into a CENTRAL trash folder under sourceRoot:
//   <sourceRoot>/.studio-helper-trash/<timestamp>/<relative-path>
//
// Companion resolution: lib/companions.js (single source of truth).
//
// Notes:
// - Builds companion index once per request (fast for big sessions)
// - Dedupes targets to avoid double-moves
// - Preserves relative path under sourceRoot to avoid collisions

import path from "path";
import fsp from "fs/promises";

import { CONFIG } from "../config.js";
import { buildCompanionIndex, resolveCompanions } from "../lib/companions.js";

/* ======================================================
   Helpers
====================================================== */

function httpError(status, message, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

function sendError(res, err) {
  const status = Number.isInteger(err?.status) ? err.status : 500;
  return res.status(status).json({
    error: "Delete session failed",
    details: { error: String(err?.message || err), code: err?.code },
  });
}

function asStringArray(v) {
  return Array.isArray(v) ? v.map((x) => String(x || "").trim()).filter(Boolean) : [];
}

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

function isoStamp() {
  // Filesystem-friendly timestamp folder
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function statIsFile(p) {
  try {
    const st = await fsp.stat(p);
    return st.isFile();
  } catch {
    return false;
  }
}

async function ensureParentDir(filePath) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
}

async function pathExists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Move a file into `trashDirAbs` preserving its relative path under sourceRoot.
 *
 * Example:
 * - sourceRootAbs: /Volumes/DISK/INPUT
 * - fileAbs:       /Volumes/DISK/INPUT/2025-06-03/A/DSC1.ARW
 * - trashDirAbs:   /Volumes/DISK/INPUT/.studio-helper-trash/<stamp>
 * => dst:          /Volumes/DISK/INPUT/.studio-helper-trash/<stamp>/2025-06-03/A/DSC1.ARW
 */
async function moveToTrashPreserveRel(fileAbs, { sourceRootAbs, trashDirAbs }) {
  const rel = path.relative(sourceRootAbs, fileAbs);

  // Safety: ensure file is truly inside sourceRoot
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw httpError(403, "Refusing to trash outside sourceRoot", "OUTSIDE_ROOT");
  }

  let dst = path.join(trashDirAbs, rel);
  await ensureParentDir(dst);

  // Avoid overwriting (rare but possible on repeated operations)
  if (await pathExists(dst)) {
    const ext = path.extname(dst);
    const base = ext ? dst.slice(0, -ext.length) : dst;
    const suffix = `-${Date.now()}`;
    dst = ext ? `${base}${suffix}${ext}` : `${base}${suffix}`;
  }

  // rename() is atomic when staying on same volume (true here because file is under sourceRoot)
  await fsp.rename(fileAbs, dst);
  return dst;
}

/* ======================================================
   Route registration
====================================================== */

export function registerDeletephotoSessionRoutes(app) {
  app.post("/api/delete-session", async (req, res) => {
    try {
      if (CONFIG.supported === false) {
        throw httpError(
          501,
          CONFIG.unsupportedReason || "Platform not supported",
          "NOT_SUPPORTED"
        );
      }

      // 1) Validate + normalize inputs
      const sourceRootAbs = normalizeAbs(req.body?.sourceRoot);
      if (!sourceRootAbs) throw httpError(400, "sourceRoot missing", "MISSING_SOURCE_ROOT");

      const files = asStringArray(req.body?.files);
      if (!files.length) throw httpError(400, "files missing", "MISSING_FILES");

      const primaryAbs = files.map(normalizeAbs).filter(Boolean);
      if (!primaryAbs.length) throw httpError(400, "files invalid", "BAD_FILES");

      // 2) Validate: all primary files must be inside sourceRoot
      for (const abs of primaryAbs) {
        if (!isPathInside(abs, sourceRootAbs)) {
          throw httpError(
            403,
            `Refusing to delete outside allowed root: ${sourceRootAbs}`,
            "OUTSIDE_ROOT"
          );
        }
      }

      // 3) Build companion index once (scope = sourceRoot)
      const index = await buildCompanionIndex(sourceRootAbs, { includeJpeg: true });

      // 4) Collect targets (primary + companions), deduped
      const targets = new Set();

      for (const abs of primaryAbs) {
        targets.add(abs);

        const companions = resolveCompanions(abs, {
          sourceRoot: sourceRootAbs,
          index,
          includeJpegForRaw: true,
        });

        for (const c of companions) {
          const cAbs = normalizeAbs(c);
          if (!cAbs) continue;
          if (isPathInside(cAbs, sourceRootAbs)) targets.add(cAbs);
        }
      }

      // 5) One trash dir per request (keeps session together)
      const trashDir = path.join(sourceRootAbs, ".studio-helper-trash", isoStamp());
      await fsp.mkdir(trashDir, { recursive: true });

      // 6) Move files
      const moved = [];
      const skipped = [];
      const errors = [];

      for (const abs of targets) {
        try {
          if (!(await statIsFile(abs))) {
            skipped.push({ path: abs, reason: "not-a-file-or-missing" });
            continue;
          }

          const dst = await moveToTrashPreserveRel(abs, {
            sourceRootAbs,
            trashDirAbs: trashDir,
          });

          moved.push({ from: abs, to: dst });
        } catch (e) {
          errors.push({ path: abs, error: String(e?.message || e) });
        }
      }

      return res.json({
        ok: true,
        sourceRoot: sourceRootAbs,
        trashedTo: trashDir,
        primaryCount: primaryAbs.length,
        targetCount: targets.size,
        movedCount: moved.length,
        moved,
        skipped,
        errors,
      });
    } catch (err) {
      return sendError(res, err);
    }
  });
}