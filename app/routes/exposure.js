// routes/exposure.js
//
// Responsibilities:
// - Provide exposure metadata for a given file path
// - Read EXIF via exiftool-vendored
// - Return a small, stable JSON payload for the UI
//
// Route:
// - GET /api/exposure?path=...

import { exiftool } from "exiftool-vendored";

/* ======================================================
   Helpers (pure)
====================================================== */

/**
 * Convert common EXIF value shapes into a finite number.
 * Accepts:
 * - number
 * - numeric string ("0.004", "125")
 * - rational-ish object ({numerator, denominator} or {num, den})
 */
function toFiniteNumber(v) {
  if (v == null) return null;

  if (typeof v === "number") {
    return Number.isFinite(v) ? v : null;
  }

  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }

  if (typeof v === "object") {
    const num = toFiniteNumber(v.numerator ?? v.num ?? v.n);
    const den = toFiniteNumber(v.denominator ?? v.den ?? v.d);
    if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) {
      return num / den;
    }
  }

  return null;
}

/**
 * Parse ExposureTime-like values into seconds.
 * Handles:
 * - number seconds (0.004)
 * - string fractions ("1/250", "1/250 s")
 * - string numbers ("0.004")
 * - rational objects
 */
function parseExposureTimeSeconds(v) {
  if (v == null) return null;

  if (typeof v === "number") {
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  if (typeof v === "string") {
    const s = v.trim().replace(/\s*(s|sec|secs)\s*$/i, "");
    if (!s) return null;

    const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (frac) {
      const num = Number(frac[1]);
      const den = Number(frac[2]);
      if (Number.isFinite(num) && Number.isFinite(den) && num > 0 && den > 0) return num / den;
      return null;
    }

    const n = toFiniteNumber(s);
    return n && n > 0 ? n : null;
  }

  // rational-ish object
  const n = toFiniteNumber(v);
  return n && n > 0 ? n : null;
}

/**
 * Format shutter speed from seconds into UI string:
 * - >= 1s => "1s", "2.5s"
 * - < 1s  => "1/250s"
 */
function formatShutterFromSeconds(seconds) {
  const t = toFiniteNumber(seconds);
  if (!t || t <= 0) return null;

  if (t >= 1) {
    const s = t >= 10 ? t.toFixed(0) : t.toFixed(1);
    return `${s.replace(/\.0$/, "")}s`;
  }

  const denom = Math.round(1 / t);
  return denom > 0 ? `1/${denom}s` : null;
}

function formatAperture(fNumber) {
  const f = toFiniteNumber(fNumber);
  if (!f || f <= 0) return null;
  return String(f.toFixed(1)).replace(/\.0$/, "");
}

function pickIso(tags) {
  // exiftool tag variance across cameras/files
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

function safePathParam(req) {
  const raw = req?.query?.path;
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Derive shutter seconds from common tag variants.
 * Tries in order:
 * - ExposureTime
 * - ShutterSpeed (sometimes already "1/250")
 * - ShutterSpeedValue (APEX Tv): seconds = 2^(-Tv)
 */
function deriveShutterSeconds(tags) {
  const sec =
    parseExposureTimeSeconds(tags?.ExposureTime) ??
    parseExposureTimeSeconds(tags?.ShutterSpeed);

  if (sec != null) return sec;

  const tv = toFiniteNumber(tags?.ShutterSpeedValue);
  if (tv != null) {
    const seconds = Math.pow(2, -tv);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  }

  return null;
}

/* ======================================================
   Route registration
====================================================== */

export function registerExposureRoutes(app) {
  if (!app || typeof app.get !== "function") {
    throw new Error("registerExposureRoutes(app): app.get is required");
  }

  app.get("/api/exposure", async (req, res) => {
    const filePath = safePathParam(req);
    if (!filePath) return res.status(400).json({ error: "missing path" });

    try {
      const tags = await exiftool.read(filePath);

      const shutterSeconds = deriveShutterSeconds(tags);
      const shutter = formatShutterFromSeconds(shutterSeconds);
      const aperture = formatAperture(tags?.FNumber);
      const iso = pickIso(tags);

      return res.json({ shutter, aperture, iso });
    } catch (e) {
      // Keep response stable; avoid leaking internals in production
      return res.status(500).json({ error: "exposure read failed" });
    }
  });
}