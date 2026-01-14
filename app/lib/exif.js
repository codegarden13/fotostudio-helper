// lib/exif.js
//
// Responsibilities:
// - Read EXIF/XMP metadata via exiftool-vendored
// - Normalize a *small, stable* set of fields for app logic + UI
// - Keep access to *all* available EXIF/XMP tags for later features
//
// Design notes:
// - This module stays filesystem-agnostic (it only reads tags for a file path)
// - Normalized fields are provided in two layers:
//   1) semantic: numbers/timestamps suitable for logic (grouping, sorting, etc.)
//   2) display: UI-friendly strings (optional convenience; still derived from semantic)
// - `tags` can be returned (opt-in) so you can later surface any EXIF field without
//   changing the contract again.
//
// Public API:
// - readExifTags(filePath): returns full exiftool tag object
// - readImageMeta(filePath, options): returns normalized fields (+ optional tags)
//
// Options:
// - includeTags   (default false): attach full tag object as `tags`
// - includeDebug  (default false): attach small debug block as `debug`
//
// IMPORTANT:
// - exiftool values can be numbers, strings, Ratio-like objects, or ExifDateTime objects.
//   The helpers below defensively parse those variants.

import { exiftool } from "exiftool-vendored";

/* ======================================================
   Generic helpers
====================================================== */

function safeStr(v) {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

/**
 * Parse a value into a finite number.
 * Supports:
 * - number
 * - numeric string ("1.25", " 200 ")
 * - "1/250" (fraction string)
 * - Ratio-like objects: { numerator, denominator } or { num, den }
 */
function toFiniteNumber(v) {
  if (v == null) return null;

  if (typeof v === "number") return Number.isFinite(v) ? v : null;

  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;

    // fraction "a/b"
    const m = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
    if (m) {
      const num = Number(m[1]);
      const den = Number(m[2]);
      if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) return num / den;
      return null;
    }

    const n = Number(s.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }

  if (typeof v === "object") {
    const num = toFiniteNumber(v.numerator ?? v.num ?? v.n);
    const den = toFiniteNumber(v.denominator ?? v.den ?? v.d);
    if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) return num / den;
  }

  return null;
}

/* ======================================================
   Date / time normalization
====================================================== */

/**
 * Normalize EXIF date-ish values to a unix timestamp in ms.
 * Handles:
 * - ExifDateTime objects (exiftool-vendored)
 * - Date
 * - EXIF strings "YYYY:MM:DD HH:MM:SS"
 * - ISO-ish strings
 */
function normalizeDateToMs(v) {
  if (!v) return null;

  // exiftool-vendored ExifDateTime
  if (typeof v === "object" && typeof v.toDate === "function") {
    const d = v.toDate();
    const t = d instanceof Date ? d.getTime() : NaN;
    return Number.isFinite(t) ? t : null;
  }

  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t : null;
  }

  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;

    // "YYYY:MM:DD HH:MM:SS" -> ISO-ish
    const m = s.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (m) {
      const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
      const t = Date.parse(iso);
      return Number.isFinite(t) ? t : null;
    }

    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  }

  return null;
}

/* ======================================================
   Exposure normalization (semantic)
====================================================== */

/**
 * Normalize shutter to seconds (number).
 *
 * Preferred:
 * - ExposureTime (seconds or "1/250")
 *
 * Fallbacks:
 * - ShutterSpeed (often "1/250")
 * - ShutterSpeedValue (APEX Tv): seconds = 2^(-Tv)
 */
function pickShutterSeconds(tags) {
  const t1 = tags?.ExposureTime;
  const sec1 = toFiniteNumber(t1);
  if (sec1 && sec1 > 0) return sec1;

  const t2 = tags?.ShutterSpeed;
  const sec2 = toFiniteNumber(t2);
  if (sec2 && sec2 > 0) return sec2;

  const tv = toFiniteNumber(tags?.ShutterSpeedValue);
  if (tv != null) {
    const seconds = Math.pow(2, -tv);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  }

  return null;
}

function pickApertureNumber(tags) {
  const f =
    toFiniteNumber(tags?.FNumber) ??
    toFiniteNumber(tags?.Aperture) ??
    toFiniteNumber(tags?.ApertureValue) ??
    null;

  return f && f > 0 ? f : null;
}

function pickIsoNumber(tags) {
  const candidates = [
    tags?.ISO,
    tags?.ISOValue,
    tags?.ISOSettings,
    tags?.PhotographicSensitivity,
    tags?.RecommendedExposureIndex,
  ];

  for (const c of candidates) {
    const n = toFiniteNumber(c);
    if (n && n > 0) return n;
  }
  return null;
}

function pickFocalLengthMm(tags) {
  const n = toFiniteNumber(tags?.FocalLength);
  return n && n > 0 ? n : null;
}

/* ======================================================
   UI formatting helpers (derived, optional convenience)
====================================================== */

function formatShutterFromSeconds(seconds) {
  const t = typeof seconds === "number" ? seconds : null;
  if (!t || t <= 0) return null;

  if (t >= 1) {
    const s = t >= 10 ? t.toFixed(0) : t.toFixed(1);
    return `${s.replace(/\.0$/, "")}s`;
  }

  const denom = Math.round(1 / t);
  return denom > 0 ? `1/${denom}s` : null;
}

function formatAperture(fNumber) {
  const f = typeof fNumber === "number" ? fNumber : null;
  if (!f || f <= 0) return null;
  // keep it UI-friendly but stable
  return `f/${f.toFixed(1).replace(/\.0$/, "")}`;
}

function formatFocalLength(mm) {
  const n = typeof mm === "number" ? mm : null;
  if (!n || n <= 0) return null;
  return `${Math.round(n)}mm`;
}

/**
 * Create a stable camera label from make/model.
 * Intentionally *not* doing filesystem naming here; that belongs in import/path utils.
 */
function makeCameraLabel(make, model) {
  const m = safeStr(make);
  const mo = safeStr(model);
  if (!m && !mo) return "Unknown";

  const combined = m && mo ? `${m} ${mo}` : (mo || m);

  // UI-stable label (keep spaces, strip odd chars)
  return combined.replace(/\s+/g, " ").trim().replace(/[^\p{L}\p{N}\-_. ]/gu, "");
}

/* ======================================================
   Public API
====================================================== */

/**
 * Full tag read (future-proof).
 * Use this when you later want to expose “everything possible”.
 */
export async function readExifTags(filePath) {
  return exiftool.read(filePath);
}

/**
 * Read normalized metadata for app usage.
 *
 * @param {string} filePath
 * @param {object} [options]
 * @param {boolean} [options.includeTags=false]   Attach full `tags` payload
 * @param {boolean} [options.includeDebug=false]  Attach small `debug` subset
 */
export async function readImageMeta(filePath, { includeTags = false, includeDebug = false } = {}) {
  const tags = await exiftool.read(filePath);

  const cameraMake = safeStr(tags?.Make);
  const cameraModel = safeStr(tags?.Model);

  const shutterSeconds = pickShutterSeconds(tags);
  const apertureNumber = pickApertureNumber(tags);
  const isoNumber = pickIsoNumber(tags);
  const focalLengthMm = pickFocalLengthMm(tags);

  const createdAt =
    normalizeDateToMs(tags?.DateTimeOriginal) ??
    normalizeDateToMs(tags?.CreateDate) ??
    normalizeDateToMs(tags?.ModifyDate) ??
    normalizeDateToMs(tags?.FileModifyDate) ??
    null;

  const out = {
    // Semantic (logic-safe)
    shutterSeconds,     // number|null
    apertureNumber,     // number|null
    isoNumber,          // number|null
    focalLengthMm,      // number|null
    createdAt,          // ms timestamp|null

    // UI convenience (derived)
    shutter: formatShutterFromSeconds(shutterSeconds), // "1/250s" | "2s" | null
    aperture: formatAperture(apertureNumber),          // "f/1.4" | null
    iso: isoNumber ?? null,                            // keep ISO as number for UI
    focalLength: formatFocalLength(focalLengthMm),     // "24mm" | null

    // Optics
    lens: safeStr(tags?.LensModel ?? tags?.Lens),

    // Camera
    cameraMake,
    cameraModel,
    cameraLabel: makeCameraLabel(cameraMake, cameraModel),
  };

  if (includeDebug) {
    out.debug = {
      ExposureTime: tags?.ExposureTime ?? null,
      ShutterSpeed: tags?.ShutterSpeed ?? null,
      ShutterSpeedValue: tags?.ShutterSpeedValue ?? null,
      FNumber: tags?.FNumber ?? null,
      Aperture: tags?.Aperture ?? null,
      ISO: tags?.ISO ?? null,
      DateTimeOriginal: tags?.DateTimeOriginal ?? null,
      CreateDate: tags?.CreateDate ?? null,
      ModifyDate: tags?.ModifyDate ?? null,
      Make: tags?.Make ?? null,
      Model: tags?.Model ?? null,
    };
  }

  if (includeTags) {
    // Full payload for future features (EXIF/XMP “everything possible”)
    out.tags = tags;
  }

  return out;
}