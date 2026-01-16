// lib/scan.js
//
// Responsibilities:
// - Extract a reliable timestamp per file (EXIF preferred, filesystem fallback)
// - Never block indefinitely on EXIF reads
//
// Notes:
// - Directory traversal belongs in fsutil.walk()


// - This module is strictly "timestamp extraction"

import fsp from "fs/promises";
import { exiftool } from "exiftool-vendored";

/* ======================================================
   Configuration
====================================================== */

const EXIF_TIMEOUT_MS = 2500;

// Set true temporarily when debugging “why are my gaps tiny?”
const DEBUG_EXIF_FALLBACK = false;

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
  return d instanceof Date && Number.isFinite(d.getTime());
}

/**
 * Convert various EXIF tag value types into a JS Date (or null).
 * exiftool-vendored may return ExifDateTime objects with toJSDate() or toDate().
 */
function toDate(value) {
  if (!value) return null;

  // exiftool-vendored ExifDateTime / ExifDate
  if (typeof value?.toJSDate === "function") {
    const d = value.toJSDate();
    return isValidDate(d) ? d : null;
  }

  // Some versions/types expose toDate()
  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return isValidDate(d) ? d : null;
  }

  // Already a JS Date
  if (isValidDate(value)) return value;

  // String (ExifTool often uses "YYYY:MM:DD HH:MM:SS" formats)
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return null;

    // Normalize common ExifTool string: "YYYY:MM:DD HH:MM:SS" -> "YYYY-MM-DDTHH:MM:SS"
    const m = s.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (m) {
      const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
      const t = Date.parse(iso);
      return Number.isFinite(t) ? new Date(t) : null;
    }

    const d = new Date(s);
    return isValidDate(d) ? d : null;
  }

  return null;
}

/**
 * Pick the most reliable capture timestamp from an EXIF tag object.
 *
 * Preference order:
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
  if (!DEBUG_EXIF_FALLBACK) return;
  // eslint-disable-next-line no-console
  console.warn("[scan.getDateTime] EXIF failed, using mtime:", filePath, String(err));
}

/* ======================================================
   Public API
====================================================== */

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
  const p = typeof filePath === "string" ? filePath.trim() : "";
  if (!p) throw new Error("getDateTime(): filePath is empty");

  try {
    const tags = await withTimeout(exiftool.read(p), EXIF_TIMEOUT_MS, "exif-read-timeout");
    const exifDate = pickExifDate(tags);
    if (exifDate) return exifDate;
  } catch (err) {
    debugExifFallback(p, err);
  }

  const stat = await fsp.stat(p);
  return stat.mtime;
}