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

function shouldSkipDirentName(name) {
  if (!name) return false;
  if (name.startsWith(".")) return true;
  return CONFIG.SKIP_DIR_NAMES.has(name);
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
 * - Continues on unreadable directories
 *
 * @param {string} rootDir
 * @param {Set<string>} allowedExts (e.g. new Set([".arw",".jpg"]))
 * @returns {Promise<string[]>}
 */
export async function walk(rootDir, allowedExts) {
  if (!allowedExts || typeof allowedExts.has !== "function") {
    throw new Error("walk(): allowedExts must be a Set");
  }

  const results = [];
  const stack = [rootDir];

  while (stack.length) {
    const dir = stack.pop();

    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      // Permission issues, transient mount state, etc.
      continue;
    }

    for (const entry of entries) {
      const name = entry.name;
      if (shouldSkipDirentName(name)) continue;

      const fullPath = path.join(dir, name);

      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;

      // extOf() should already normalize case; if not, ensure extOf returns lower-case.
      if (allowedExts.has(extOf(fullPath))) {
        results.push(fullPath);
      }
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