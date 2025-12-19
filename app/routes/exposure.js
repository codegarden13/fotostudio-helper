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

function toNumber(v) {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatShutter(exposureTimeSec) {
  const t = toNumber(exposureTimeSec);
  if (!t || t <= 0) return null;

  // >= 1s: show seconds (e.g. "1s", "2.5s")
  if (t >= 1) {
    const s = t >= 10 ? t.toFixed(0) : t.toFixed(1);
    return `${s.replace(/\.0$/, "")}s`;
  }

  // < 1s: show reciprocal (e.g. "1/250s")
  const denom = Math.round(1 / t);
  return denom > 0 ? `1/${denom}s` : null;
}

function formatAperture(fNumber) {
  const f = toNumber(fNumber);
  if (!f || f <= 0) return null;

  // Return just the numeric part; UI can render "ƒ/<aperture>"
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
    const n = toNumber(c);
    if (n && n > 0) return n;
  }
  return null;
}

function safePathParam(req) {
  const raw = req?.query?.path;
  return typeof raw === "string" ? raw.trim() : "";
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

      const shutter = formatShutter(tags?.ExposureTime);
      const aperture = formatAperture(tags?.FNumber);
      const iso = pickIso(tags);

      // Minimal, stable payload for UI rendering
      return res.json({ shutter, aperture, iso });
    } catch (e) {
      // Keep response stable; avoid leaking internals in production
      return res.status(500).json({ error: "exposure read failed" });
    }
  });
}