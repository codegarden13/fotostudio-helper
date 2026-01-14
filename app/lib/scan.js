// lib/scan.js
//
// Responsibilities:
// - Walk a camera/DCIM directory and collect supported files
// - Extract a reliable timestamp per file (EXIF preferred, filesystem fallback)
// - Never block indefinitely on EXIF reads
//
// Design notes:
// - Iterative directory walk (no recursion depth risk)
// - Per-file EXIF timeout to avoid scan hangs
// - Skips common system folders on removable volumes
// - Robust EXIF timestamp extraction (handles ExifDateTime/Date/string)
// - Optional debug logging for EXIF fallbacks (off by default)


import path from "path";
import fsp from "fs/promises";
import { exiftool } from "exiftool-vendored";
import { extOf } from "./fsutil.js";



function shouldSkipDirentName(name) {
  if (!name) return true;
  // keep your existing skip set if you have it; otherwise:
  return (
    name === ".Spotlight-V100" ||
    name === ".Trashes" ||
    name === ".fseventsd" ||
    name === "System Volume Information"
  );
}

/* ======================================================
   Configuration
   ====================================================== */

const CONFIG = {
  EXIF_TIMEOUT_MS: 2500,

  // Skip common system directories on removable volumes
  SKIP_DIR_NAMES: new Set([
    ".Spotlight-V100",
    ".Trashes",
    ".fseventsd",
    "System Volume Information",
  ]),

  // Set true temporarily when debugging “why are my gaps tiny?”
  DEBUG_EXIF_FALLBACK: false,
};

/* ======================================================
   Internal helpers
   ====================================================== */

function withTimeout(promise, ms, label = "timeout") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isValidDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/**
 * Convert various EXIF tag value types into a JS Date (or null).
 * exiftool-vendored typically returns ExifDateTime objects with toJSDate().
 */
function toDate(value) {
  if (!value) return null;

  // exiftool-vendored ExifDateTime / ExifDate
  if (typeof value?.toJSDate === "function") {
    const d = value.toJSDate();
    return isValidDate(d) ? d : null;
  }

  // Already a JS Date
  if (isValidDate(value)) return value;

  // Sometimes strings appear depending on tags/types
  if (typeof value === "string") {
    const d = new Date(value);
    return isValidDate(d) ? d : null;
  }

  return null;
}

/**
 * Pick the most reliable capture timestamp from an EXIF tag object.
 * Order is intentional:
 * - SubSecDateTimeOriginal / DateTimeOriginal: best capture time
 * - SubSecCreateDate / CreateDate: often capture time on many cameras
 * - GPSDateTime: sometimes present if GPS recorded
 * - ModifyDate: weakest (often file write time)
 */
function pickExifDate(tags) {
  if (!tags) return null;

  const candidates = [
    tags.SubSecDateTimeOriginal,
    tags.DateTimeOriginal,

    tags.SubSecCreateDate,
    tags.CreateDate,

    tags.GPSDateTime,

    tags.ModifyDate,
  ];

  for (const c of candidates) {
    const d = toDate(c);
    if (d) return d;
  }
  return null;
}



function debugExifFallback(filePath, err) {
  if (!CONFIG.DEBUG_EXIF_FALLBACK) return;
  console.warn("[scan.getDateTime] EXIF failed, using mtime:", filePath, String(err));
}

/* ======================================================
   Public API
   ====================================================== */



/**
 * Walk a directory tree iteratively and return all files
 * matching the allowed extensions.
 *
 * - Skips dotfiles and known system folders
 * - Continues on unreadable *sub*directories
 * - BUT: rootDir must be readable, otherwise throw (so scan doesn't return 0 silently)
 */
export async function walk(rootDir, allowedExts) {
  if (!allowedExts || typeof allowedExts.has !== "function") {
    throw new Error("walk(): allowedExts must be a Set");
  }

  const root = path.resolve(String(rootDir || "").trim());
  if (!root) throw new Error("walk(): rootDir is empty");

  // Root must exist + be a directory + be readable
  let st;
  try {
    st = await fsp.stat(root);
  } catch (e) {
    e.message = `walk(): rootDir does not exist: ${root}`;
    throw e;
  }
  if (!st.isDirectory()) {
    throw new Error(`walk(): rootDir is not a directory: ${root}`);
  }

  try {
    await fsp.access(root); // will throw on EPERM/EACCES
  } catch (e) {
    e.message = `walk(): rootDir not accessible (permissions?): ${root}`;
    throw e;
  }

  const results = [];
  const stack = [root];

  while (stack.length) {
    const dir = stack.pop();

    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      // subfolders may be unreadable -> skip
      continue;
    }

    for (const entry of entries) {
      const name = entry.name;
      if (shouldSkipDirentName(name)) continue;

      // Skip hidden files/folders everywhere (optional but usually desired)
      if (name.startsWith(".")) continue;

      const fullPath = path.join(dir, name);

      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;

      const ext = extOf(fullPath); // should be lower-case already in your fsutil.js
      if (allowedExts.has(ext)) results.push(fullPath);
    }
  }

  return results;
}

/**
 * Determine the best timestamp for a file.
 *
 * Order:
 * 1) EXIF capture timestamps (DateTimeOriginal/CreateDate/etc.)
 * 2) Filesystem mtime (fallback)
 *
 * EXIF reads are time-limited to prevent hangs.
 *
 * @param {string} filePath
 * @returns {Promise<Date>}
 */
export async function getDateTime(filePath) {
  try {
    const tags = await withTimeout(
      exiftool.read(filePath),
      CONFIG.EXIF_TIMEOUT_MS,
      "exif-read-timeout"
    );

    const exifDate = pickExifDate(tags);
    if (exifDate) return exifDate;
  } catch (err) {
    debugExifFallback(filePath, err);
  }

  const stat = await fsp.stat(filePath);
  return stat.mtime;
}