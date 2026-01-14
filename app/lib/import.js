// lib/import.js
//
// Responsibilities:
// - Provide safe, reusable import primitives for the server
// - Treat targetRoot as an existing mount (do NOT mkdir targetRoot)
// - Build YYYY/MM/YYYY-MM-DD Title/{originals,exports} under targetRoot
// - Copy files idempotently (skip if already exists)
// - Route RAW→JPEG companions into exports/jpg
// - Provide clear errors for non-existent / non-writable roots

import path from "path";
import fs from "fs";
import fsp from "fs/promises";

import { LOG } from "../server.js";
import { readImageMeta } from "./exif.js";
import { findCompanionsForImage } from "./companions.js";

/* ======================================================
   File type constants
====================================================== */

const RAW_EXTS = new Set([
  ".arw", ".cr2", ".cr3", ".nef", ".raf", ".dng",
  ".rw2", ".orf", ".pef", ".srw",
]);

const JPEG_EXTS = new Set([".jpg", ".jpeg"]);

/* ======================================================
   Small helpers (pure)
====================================================== */

const pad2 = (n) => String(n).padStart(2, "0");

function trimStr(v) {
  const s = String(v ?? "").trim();
  return s || "";
}

function extLower(p) {
  return path.extname(trimStr(p)).toLowerCase();
}

function isRawPath(p) {
  return RAW_EXTS.has(extLower(p));
}

function isJpegPath(p) {
  return JPEG_EXTS.has(extLower(p));
}

function makeErr(message, { code = "ERROR", status = 500, cause } = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  if (cause) err.cause = cause;
  return err;
}

function requireNonEmptyString(v, { label, code = "BAD_ARGS", status = 400 } = {}) {
  const s = trimStr(v);
  if (!s) throw makeErr(`${label} is missing`, { code, status });
  return s;
}

function ensureCameraPrefix(filename, cameraLabel) {
  const base = String(filename || "");
  const cam = trimStr(cameraLabel) || "Unknown";
  const prefix = `${cam}__`;
  return base.startsWith(prefix) ? base : prefix + base;
}

/* ======================================================
   Root validation (mount-safe)
====================================================== */

export async function assertWritableRoot(targetRoot) {
  const root = requireNonEmptyString(targetRoot, {
    label: "Target root",
    code: "MISSING_ROOT",
    status: 400,
  });

  let st;
  try {
    st = await fsp.stat(root);
  } catch (cause) {
    throw makeErr(`Target root does not exist (not mounted?): ${root}`, {
      code: "ROOT_NOT_FOUND",
      status: 409,
      cause,
    });
  }

  if (!st.isDirectory()) {
    throw makeErr(`Target root is not a directory: ${root}`, {
      code: "NOT_A_DIRECTORY",
      status: 409,
    });
  }

  try {
    await fsp.access(root, fs.constants.W_OK);
  } catch (cause) {
    throw makeErr(`Target root is not writable: ${root}`, {
      code: "NOT_WRITABLE",
      status: 403,
      cause,
    });
  }

  return root;
}

/* ======================================================
   Naming helpers
====================================================== */

export function ymdFromTs(ts) {
  const n = typeof ts === "number" ? ts : Number(ts);
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return null;

  const yyyy = String(d.getFullYear());
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());

  return { yyyy, mm, dd, ymd: `${yyyy}-${mm}-${dd}` };
}

export function sanitizeTitle(input, { fallback = "Untitled", maxLen = 80 } = {}) {
  const s = trimStr(input);
  if (!s) return fallback;

  const out = s
    .replace(/\s+/g, " ")
    .replace(/[\/\\]/g, "-")
    .replace(/[:*?"<>|]/g, "")
    .replace(/[^\p{L}\p{N}\s._()-]/gu, "")
    .trim()
    .slice(0, maxLen);

  const cleaned = out.replace(/[.\s]+$/g, "").trim();
  return cleaned || fallback;
}

/* ======================================================
   Folder layout
====================================================== */

export function buildSessionFolders({ targetRoot, firstImageTs, title }) {
  const root = requireNonEmptyString(targetRoot, {
    label: "buildSessionFolders(): targetRoot",
    code: "MISSING_ROOT",
    status: 400,
  });

  const parts = ymdFromTs(firstImageTs);
  if (!parts) {
    throw makeErr("buildSessionFolders(): invalid firstImageTs", {
      code: "BAD_TIMESTAMP",
      status: 400,
    });
  }

  const safeTitle = sanitizeTitle(title);
  const sessionDirName = `${parts.ymd} ${safeTitle}`.trim();

  const yearDir = path.join(root, parts.yyyy);
  const monthDir = path.join(yearDir, parts.mm);
  const sessionDir = path.join(monthDir, sessionDirName);

  const folders = {
    yearDir,
    monthDir,
    sessionDir,
    originalsDir: path.join(sessionDir, "originals"),
    exportsDir: path.join(sessionDir, "exports"),
    sessionDirName,
    ymd: parts.ymd,
  };

  LOG.info("[import] buildSessionFolders", {
    sessionDir: folders.sessionDir,
    originalsDir: folders.originalsDir,
    exportsDir: folders.exportsDir,
  });

  return folders;
}

export async function ensureSessionFolders(folders) {
  const { yearDir, monthDir, sessionDir, originalsDir, exportsDir } = folders || {};
  if (!yearDir || !monthDir || !sessionDir || !originalsDir || !exportsDir) {
    throw makeErr("ensureSessionFolders(): invalid folders object", {
      code: "BAD_FOLDERS",
      status: 500,
    });
  }

  await fsp.mkdir(yearDir, { recursive: true });
  await fsp.mkdir(monthDir, { recursive: true });
  await fsp.mkdir(sessionDir, { recursive: true });
  await fsp.mkdir(originalsDir, { recursive: true });
  await fsp.mkdir(exportsDir, { recursive: true });

  return folders;
}

/* ======================================================
   File copy primitive (idempotent)
====================================================== */

export async function copyFileEnsured(src, dst) {
  const s = requireNonEmptyString(src, { label: "copyFileEnsured(): src" });
  const d = requireNonEmptyString(dst, { label: "copyFileEnsured(): dst" });

  await fsp.mkdir(path.dirname(d), { recursive: true });

  try {
    await fsp.access(d, fs.constants.F_OK);
    return { copied: false };
  } catch {
    await fsp.copyFile(s, d);
    return { copied: true };
  }
}

/* ======================================================
   Copy (primary + companions)
====================================================== */

/**
 * Copy primary files and companions.
 *
 * Rules:
 * - Primary file ALWAYS -> originals/
 * - Companion files:
 *   - .xmp / .on1 / .onphoto / etc. -> originals/
 *   - JPG/JPEG companion of a RAW primary -> exports/jpg/
 * - Every copied file is prefixed with its OWN camera label (or "Unknown")
 * - Idempotent: skips if dst exists
 *
 * @returns {Promise<{copied:number, skipped:number, fileMap:Array}>}
 */
export async function copyOriginalsWithCompanions({
  files,
  originalsDir,
  exportsDir,
  includeJpegForRaw = true,
} = {}) {
  const inputFiles = Array.isArray(files) ? files : [];

  const originals = requireNonEmptyString(originalsDir, {
    label: "copyOriginalsWithCompanions(): originalsDir",
  });

  const exportsBase = requireNonEmptyString(exportsDir, {
    label: "copyOriginalsWithCompanions(): exportsDir",
  });

  // Ensure exports/jpg exists (routing target)
  const exportsJpgDir = path.join(exportsBase, "jpg");
  await fsp.mkdir(exportsJpgDir, { recursive: true });

  let copied = 0;
  let skipped = 0;
  const fileMap = [];

  // Cache camera label per absolute file path to avoid repeated EXIF reads
  const camCache = new Map(); // absPath -> label

  async function cameraLabelFor(absPath) {
    const key = trimStr(absPath);
    if (!key) return "Unknown";
    if (camCache.has(key)) return camCache.get(key);

    let label = "Unknown";
    try {
      const meta = await readImageMeta(key);
      label = trimStr(meta?.cameraLabel) || "Unknown";
    } catch {
      // ignore; keep Unknown
    }

    camCache.set(key, label);
    return label;
  }

  async function copyOne({ src, dstDir, dstRelPrefix }) {
    const cam = await cameraLabelFor(src);
    const dstName = ensureCameraPrefix(path.basename(src), cam);
    const dst = path.join(dstDir, dstName);

    const { copied: didCopy } = await copyFileEnsured(src, dst);
    didCopy ? copied++ : skipped++;

    fileMap.push({
      src,
      camera: cam,
      dstName,
      dstRel: `${dstRelPrefix}/${dstName}`,
    });
  }

  for (const primarySrc of inputFiles) {
    const primary = trimStr(primarySrc);
    if (!primary) continue;

    const primaryIsRaw = isRawPath(primary);

    // 1) Primary always -> originals
    await copyOne({
      src: primary,
      dstDir: originals,
      dstRelPrefix: "originals",
    });

    // 2) Companions
    const companions = await findCompanionsForImage(primary, { includeJpegForRaw });

    for (const compSrc of companions) {
      const comp = trimStr(compSrc);
      if (!comp) continue;

      const routeToExportsJpg = primaryIsRaw && isJpegPath(comp);

      await copyOne({
        src: comp,
        dstDir: routeToExportsJpg ? exportsJpgDir : originals,
        dstRelPrefix: routeToExportsJpg ? "exports/jpg" : "originals",
      });
    }
  }

  return { copied, skipped, fileMap };
}