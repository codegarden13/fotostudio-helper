// routes/delete-photoSession.js
//
// POST /api/delete-session
// Body: { sourceRoot: string, files: string[] }
//
// Deletes each file plus companions, but ONLY if paths are inside sourceRoot.
// Companion resolution is delegated to lib/companions.js (single source of truth).
//
// Notes:
// - Builds a companion index once per request (fast for big sessions)
// - Dedupes delete targets to avoid double-unlink noise
// - No unused stripExt() here anymore

import path from "path";
import fsp from "fs/promises";

import { CONFIG } from "../config.js";
import { buildCompanionIndex, resolveCompanions } from "../lib/companions.js";

/* ======================================================
   Small helpers
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
  return Array.isArray(v)
    ? v.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
}

function isPathInside(childAbs, parentAbs) {
  const rel = path.relative(parentAbs, childAbs);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

async function unlinkIfExists(absPath) {
  try {
    await fsp.unlink(absPath);
    return { deleted: true };
  } catch (e) {
    if (e?.code === "ENOENT") return { deleted: false, missing: true };
    throw e;
  }
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

      const sourceRoot = String(req.body?.sourceRoot || "").trim();
      if (!sourceRoot) throw httpError(400, "sourceRoot missing", "MISSING_SOURCE_ROOT");

      const sourceRootAbs = path.resolve(sourceRoot);

      const files = asStringArray(req.body?.files);
      if (!files.length) throw httpError(400, "files missing", "MISSING_FILES");

      // Validate: all primary files must be inside sourceRoot
      const primaryAbs = files.map((f) => path.resolve(f));
      for (const abs of primaryAbs) {
        if (!isPathInside(abs, sourceRootAbs)) {
          throw httpError(
            403,
            `Refusing to delete outside allowed root: ${sourceRootAbs}`,
            "OUTSIDE_ROOT"
          );
        }
      }

      // Build companion index once (scope = sourceRoot)
      const index = await buildCompanionIndex(sourceRootAbs, { includeJpeg: true });

      // Collect delete targets (primary + companions), deduped
      const targets = new Set();

      for (const abs of primaryAbs) {
        targets.add(abs);

        const companions = resolveCompanions(abs, {
          sourceRoot: sourceRootAbs,
          index,
          includeJpegForRaw: true,
        });

        for (const c of companions) {
          const cAbs = path.resolve(c);

          // Safety: companions must also be inside sourceRoot
          if (!isPathInside(cAbs, sourceRootAbs)) continue;

          targets.add(cAbs);
        }
      }

      // Delete
      let deleted = 0;
      let missing = 0;

      for (const abs of targets) {
        const r = await unlinkIfExists(abs);
        if (r.deleted) deleted++;
        else if (r.missing) missing++;
      }

      return res.json({
        ok: true,
        sourceRoot: sourceRootAbs,
        primaryCount: primaryAbs.length,
        targetCount: targets.size,
        deleted,
        missing,
      });
    } catch (err) {
      return sendError(res, err);
    }
  });
}