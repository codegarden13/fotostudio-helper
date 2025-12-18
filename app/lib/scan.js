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
// - More robust EXIF timestamp extraction (handles DateTimeOriginal/CreateDate/etc.)
// - Optional debug logging for EXIF fallbacks (off by default)

import path from "path";
import fsp from "fs/promises";
import { exiftool } from "exiftool-vendored";
import { extOf } from "./fsutil.js";

/* ======================================================
   Configuration
   ====================================================== */

// Hard timeout per EXIF read (ms)
const EXIF_TIMEOUT_MS = 2500;

// Skip common system directories on removable volumes
const SKIP_DIR_NAMES = new Set([
  ".Spotlight-V100",
  ".Trashes",
  ".fseventsd",
  "System Volume Information",
]);

// Set to true temporarily when debugging “why are my gaps tiny?”
const DEBUG_EXIF_FALLBACK = false;

/* ======================================================
   Internal helpers
   ====================================================== */

/**
 * Wrap a promise with a timeout.
 * If the timeout fires first, the returned promise rejects.
 */
function withTimeout(promise, ms, label = "timeout") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Convert various EXIF tag value types into a JS Date (or null).
 * exiftool-vendored typically returns ExifDateTime objects with toJSDate(),
 * but some tags can come back as Date or string depending on tag/type.
 */
function toDate(value) {
  if (!value) return null;

  if (typeof value?.toJSDate === "function") {
    const d = value.toJSDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === "string") {
    const d = new Date(value);
    return !Number.isNaN(d.getTime()) ? d : null;
  }

  return null;
}

/**
 * Pick the most reliable capture timestamp from an EXIF tag object.
 * Order is intentional:
 * - DateTimeOriginal / SubSecDateTimeOriginal: best representation of capture time
 * - CreateDate / SubSecCreateDate: also typically capture time on many cameras
 * - GPSDateTime: can be present if GPS recorded
 * - ModifyDate: weakest (often file write time)
 */
function pickExifDate(tags) {
  const candidates = [
    tags?.SubSecDateTimeOriginal,
    tags?.DateTimeOriginal,

    tags?.SubSecCreateDate,
    tags?.CreateDate,

    tags?.GPSDateTime,

    tags?.ModifyDate,
  ];

  for (const c of candidates) {
    const d = toDate(c);
    if (d) return d;
  }
  return null;
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
 * @param {Set<string>} allowedExts
 * @returns {Promise<string[]>}
 */
export async function walk(rootDir, allowedExts) {
  if (!allowedExts || typeof allowedExts.has !== "function") {
    throw new Error("walk(): allowedExts must be a Set");
  }

  const results = [];
  const stack = [rootDir];

  while (stack.length > 0) {
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

      // Cheap early skips
      if (name.startsWith(".")) continue;
      if (SKIP_DIR_NAMES.has(name)) continue;

      const fullPath = path.join(dir, name);

      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && allowedExts.has(extOf(fullPath))) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

/**
 * Determine the best timestamp for a file.
 *
 * Order of preference:
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
      EXIF_TIMEOUT_MS,
      "exif-read-timeout"
    );

    const exifDate = pickExifDate(tags);
    if (exifDate) return exifDate;
  } catch (err) {
    // EXIF errors or timeout → fall back to filesystem
    if (DEBUG_EXIF_FALLBACK) {
      // Keep log volume low; filePath only.
      console.warn("[getDateTime] EXIF failed, using mtime:", filePath, String(err));
    }
  }

  const stat = await fsp.stat(filePath);
  return stat.mtime;
}