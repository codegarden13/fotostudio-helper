

// lib/preview.js
import fsp from "fs/promises";
import { exiftool } from "exiftool-vendored";
import { CONFIG } from "../config.js";
import { ensureDir, previewCachePath } from "../lib/fsutil.js";

/**
 * Extract an embedded JPEG preview from a RAW file (ARW, DNG, NEF, …).
 * Uses exiftool only (no ImageMagick fallback).
 *
 * @param {string} rawPath absolute path to RAW/DNG file
 * @returns {Promise<string>} path to cached JPEG preview
 */
export async function extractRawPreview(rawPath) {
  await ensureDir(CONFIG.previewCacheDir);

  const cached = previewCachePath(rawPath);

  // Reuse cache if up-to-date
  try {
    const [srcStat, cacheStat] = await Promise.all([
      fsp.stat(rawPath),
      fsp.stat(cached),
    ]);
    if (cacheStat.size > 0 && cacheStat.mtimeMs >= srcStat.mtimeMs) {
      return cached;
    }
  } catch {
    // cache miss
  }

  // 1) Try embedded preview (PreviewImage)
  try {
    await exiftool.extractPreview(rawPath, cached);
    const st = await fsp.stat(cached);
    if (st.size > 0) return cached;
  } catch {
    // ignore, try next
  }

  // 2) Try JPEG from RAW (JpgFromRaw)
  await exiftool.extractJpgFromRaw(rawPath, cached);

  const finalStat = await fsp.stat(cached);
  if (!finalStat.size) {
    throw new Error("RAW preview extraction failed (empty output)");
  }

  return cached;
}