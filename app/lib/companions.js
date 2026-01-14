// app/lib/companions.js
//
// Responsibilities:
// - Resolve companion files for a given primary image path
// - Used by import + delete (single source of truth)
//
// Companion rules (within selected sourceRoot, recursive):
// - XMP sidecars:
//    - base.xmp OR fullName.xmp   (DSC1.xmp, DSC1.ARW.xmp)
// - ON1 / OnPhoto artifacts (by prefix/base match):
//    - DSC01234.on1
//    - DSC01234.ARW.on1
//    - DSC01234.on1.xml
//    - DSC01234.onphoto
//    - DSC01234.onphoto.*
// - JPG companion for RAW:
//    - base.jpg / base.jpeg
//
// Design:
// - "Anywhere under sourceRoot": build an index once, resolve many.
// - For small operations or debugging: findCompanionsSameDir().
//
// Notes:
// - Companion resolution is scoped to sourceRoot for safety.
// - Never throws due to unreadable directories; simply skips them.

import path from "path";
import fsp from "fs/promises";

/* ======================================================
   Constants
====================================================== */

export const RAW_EXTS = new Set([
  ".arw", ".cr2", ".cr3", ".nef", ".raf", ".dng", ".rw2", ".orf", ".pef", ".srw",
]);

const JPEG_EXTS = new Set([".jpg", ".jpeg"]);
const XMP_EXT = ".xmp";

// Finder-ish noise (skip)
const SKIP_DIR_NAMES = new Set([
  ".Trashes",
  ".Spotlight-V100",
  ".fseventsd",
  "__MACOSX",
]);

/* ======================================================
   Helpers (pure)
====================================================== */

function toStr(v) {
  return typeof v === "string" ? v : "";
}

function lower(s) {
  return toStr(s).toLowerCase();
}

function extLower(p) {
  return lower(path.extname(toStr(p)));
}

function stripExt(filename) {
  const fn = toStr(filename);
  const ext = path.extname(fn);
  return ext ? fn.slice(0, -ext.length) : fn;
}

function isRawName(filename) {
  return RAW_EXTS.has(extLower(filename));
}

function isJpegName(filename) {
  return JPEG_EXTS.has(extLower(filename));
}

function isXmpName(filename) {
  return extLower(filename) === XMP_EXT;
}

function isHiddenName(name) {
  return toStr(name).startsWith(".");
}

function shouldSkipDirName(name) {
  if (!name) return true;
  if (isHiddenName(name)) return true;
  return SKIP_DIR_NAMES.has(name);
}

function isOnArtifactNameLower(fileNameLower) {
  // includes DSC01234.onphoto, DSC01234.onphoto.*, DSC01234.on1.xml, etc.
  return fileNameLower.includes(".on1") || fileNameLower.includes(".onphoto");
}

/**
 * For DSC01234.ARW:
 * - base: "DSC01234"
 * - full: "DSC01234.ARW"
 * - baseKey/fullKey: lowercased keys
 */
function makeKeys(primaryFileName) {
  const full = toStr(primaryFileName).trim();
  const base = stripExt(full);

  return {
    base,
    full,
    baseKey: lower(base),
    fullKey: lower(full),
  };
}

/**
 * Strict-ish "belongs" check:
 * - Must start with base or full (case sensitive like Finder list)
 * - Optionally allow: base + separator + ... (e.g. "DSC01234 (1).onphoto")
 */
function belongsToBaseOrFull(fileName, { base, full } = {}) {
  const fn = toStr(fileName);
  if (!fn || !base || !full) return false;

  if (fn.startsWith(full)) return true;
  if (fn.startsWith(base)) return true;

  // Optional forgiving: base + separator pattern
  // Example: "DSC01234 (1).onphoto"
  if (fn.length > base.length) {
    const next = fn.slice(base.length, base.length + 1);
    if (/[ ._()\-]/.test(next) && fn.startsWith(base)) return true;
  }

  return false;
}

/**
 * Root-scope safety check.
 * Returns normalized absolute root and absolute path.
 */
function assertInsideRoot(absPath, absRoot) {
  const root = path.resolve(toStr(absRoot || "").trim());
  const p = path.resolve(toStr(absPath || "").trim());

  if (!root) throw new Error("sourceRoot is required");
  if (!p) throw new Error("primaryPath is required");

  const rel = path.relative(root, p);

  // If rel starts with ".." OR is absolute (should not happen) => outside root
  if (rel === "" || rel.startsWith("..") || rel.includes(`..${path.sep}`)) {
    // rel=="" means p===root; that is not a file path, but we treat it as outside for primary file usage
    throw new Error("primaryPath is outside sourceRoot");
  }

  return { root, p };
}



export async function findCompanionsForImage(srcPath) {
  const dir = path.dirname(srcPath);
  const name = path.basename(srcPath);

  const base = stripExt(name);
  const fullBase = name;

  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const fn = e.name;
    const lower = fn.toLowerCase();

    // XMP variants
    if (fn === `${base}.xmp` || fn === `${fullBase}.xmp`) {
      out.push(path.join(dir, fn));
      continue;
    }

    // ON1 / ONPHOTO artifacts
    if (fn.startsWith(base) && (lower.includes(".on1") || lower.includes(".onphoto"))) {
      out.push(path.join(dir, fn));
      continue;
    }
  }

  return [...new Set(out)];
}

/* ======================================================
   Same-directory resolver (fast path)
====================================================== */

export async function findCompanionsSameDir(primaryPath, { includeJpegForRaw = true } = {}) {
  const src = toStr(primaryPath).trim();
  if (!src) return [];

  const dir = path.dirname(src);
  const name = path.basename(src);

  const { base, full } = makeKeys(name);
  const primaryIsRaw = isRawName(name);

  // exact sidecar names (case-insensitive compare at check time)
  const want = new Set([
    lower(`${base}${XMP_EXT}`),
    lower(`${full}${XMP_EXT}`),
  ]);

  if (includeJpegForRaw && primaryIsRaw) {
    want.add(lower(`${base}.jpg`));
    want.add(lower(`${base}.jpeg`));
  }

  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out = new Set();

  for (const e of entries) {
    if (!e.isFile()) continue;

    const fn = e.name;
    if (isHiddenName(fn)) continue;

    const fnLower = lower(fn);

    // XMP + optional JPEG exact matches
    if (want.has(fnLower)) {
      out.add(path.join(dir, fn));
      continue;
    }

    // ON1 / OnPhoto artifacts
    if (isOnArtifactNameLower(fnLower) && belongsToBaseOrFull(fn, { base, full })) {
      out.add(path.join(dir, fn));
      continue;
    }
  }

  return Array.from(out);
}

/* ======================================================
   Global index (within sourceRoot)
====================================================== */

/**
 * Index structure:
 * - key: lower(stripExt(fileName))  e.g. "dsc01234", "dsc01234.arw", "dsc01234.on1"
 * - value: Set<absolute paths>
 *
 * We index candidates only:
 * - *.xmp
 * - files containing ".on1" or ".onphoto"
 * - *.jpg/*.jpeg (optional)
 */
export async function buildCompanionIndex(sourceRoot, { includeJpeg = true } = {}) {
  const root = path.resolve(toStr(sourceRoot).trim());
  if (!root) throw new Error("buildCompanionIndex(): sourceRoot is required");

  const index = new Map();
  const stack = [root];

  while (stack.length) {
    const dir = stack.pop();

    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable dir => skip
    }

    for (const entry of entries) {
      const name = entry.name;

      // Skip dot dirs/files and common system dirs
      if (entry.isDirectory()) {
        if (shouldSkipDirName(name)) continue;
        stack.push(path.join(dir, name));
        continue;
      }

      if (!entry.isFile()) continue;
      if (isHiddenName(name)) continue;

      const nameLower = lower(name);

      const candidate =
        isXmpName(nameLower) ||
        isOnArtifactNameLower(nameLower) ||
        (includeJpeg && isJpegName(nameLower));

      if (!candidate) continue;

      const key = lower(stripExt(name));
      if (!key) continue;

      let bucket = index.get(key);
      if (!bucket) {
        bucket = new Set();
        index.set(key, bucket);
      }
      bucket.add(path.join(dir, name));
    }
  }

  return index;
}

/* ======================================================
   Anywhere-under-root resolver (recommended)
====================================================== */

/**
 * Resolve companions for `primaryPath` within `sourceRoot` using a pre-built index.
 *
 * Recommended usage:
 *   const idx = await buildCompanionIndex(sourceRoot);
 *   const companions = resolveCompanions(primaryPath, { sourceRoot, index: idx })
 */
export function resolveCompanions(
  primaryPath,
  { sourceRoot, index, includeJpegForRaw = true } = {}
) {
  if (!index || typeof index.get !== "function") {
    throw new Error("resolveCompanions(): index (Map) is required. Use buildCompanionIndex().");
  }

  const { root, p } = assertInsideRoot(primaryPath, sourceRoot);

  const name = path.basename(p);
  const { base, full, baseKey, fullKey } = makeKeys(name);
  const primaryIsRaw = isRawName(name);

  const out = new Set();

  // --- 1) XMP exact matches ---
  const wantBaseXmp = `${lower(base)}.xmp`;
  const wantFullXmp = `${lower(full)}.xmp`;

  for (const abs of index.get(baseKey) || []) {
    if (lower(path.basename(abs)) === wantBaseXmp) out.add(abs);
  }
  for (const abs of index.get(fullKey) || []) {
    if (lower(path.basename(abs)) === wantFullXmp) out.add(abs);
  }

  // --- 2) ON1 / OnPhoto artifacts ---
  // Because index keys are stripExt(name), ON artifacts may live under keys like:
  // - dsc01234            (DSC01234.onphoto)
  // - dsc01234.arw        (DSC01234.ARW.on1)
  // - dsc01234.on1        (DSC01234.on1.xml)
  //
  // We therefore inspect a small, deterministic set of buckets.
  const bucketKeys = [
    baseKey,
    fullKey,
    `${baseKey}.on1`,
    `${fullKey}.on1`,
    `${baseKey}.onphoto`,
    `${fullKey}.onphoto`,
  ];

  for (const k of bucketKeys) {
    const bucket = index.get(k);
    if (!bucket) continue;

    for (const abs of bucket) {
      // Safety: never allow companions outside root even if index got polluted
      const rel = path.relative(root, abs);
      if (rel.startsWith("..") || rel.includes(`..${path.sep}`)) continue;

      const fn = path.basename(abs);
      const fnLower = lower(fn);

      if (!isOnArtifactNameLower(fnLower)) continue;
      if (belongsToBaseOrFull(fn, { base, full })) out.add(abs);
    }
  }

  // --- 3) JPG companion for RAW (base.jpg/base.jpeg) ---
  if (includeJpegForRaw && primaryIsRaw) {
    const wantJpg = `${lower(base)}.jpg`;
    const wantJpeg = `${lower(base)}.jpeg`;

    for (const abs of index.get(baseKey) || []) {
      const fnLower = lower(path.basename(abs));
      if (fnLower === wantJpg || fnLower === wantJpeg) out.add(abs);
    }
  }

  return Array.from(out);
}