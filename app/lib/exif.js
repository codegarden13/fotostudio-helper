// lib/exif.js
import { exiftool } from "exiftool-vendored";

/**
 * Read exposure-related EXIF data from a file.
 * Returns normalized values suitable for UI display.
 */
export async function readExposure(filePath) {
  const tags = await exiftool.read(filePath);

  // Shutter
  let shutter = null;
  if (typeof tags.ExposureTime === "number" && tags.ExposureTime > 0) {
    const t = tags.ExposureTime;
    shutter = t >= 1 ? `${t.toFixed(1)}s` : `1/${Math.round(1 / t)}s`;
  }

  // Aperture
  const aperture =
    typeof tags.FNumber === "number" ? tags.FNumber.toFixed(1) : null;

  // ISO
  const iso =
    tags.ISO || tags.ISOValue || tags.RecommendedExposureIndex || null;

  return { shutter, aperture, iso };
}