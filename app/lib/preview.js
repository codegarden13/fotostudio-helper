import fsp from "fs/promises";
import { exiftool } from "exiftool-vendored";
import { CONFIG } from "../config.js";
import { ensureDir, previewCachePath } from "../lib/fsutil.js";

export async function extractArwPreview(arwPath) {
  await ensureDir(CONFIG.previewCacheDir);

  const cached = previewCachePath(arwPath);

  // reuse cache if up-to-date and non-empty
  try {
    const [srcStat, cacheStat] = await Promise.all([
      fsp.stat(arwPath),
      fsp.stat(cached),
    ]);
    if (cacheStat.size > 0 && cacheStat.mtimeMs >= srcStat.mtimeMs) return cached;
  } catch {
    // cache miss
  }

  // 1) Try embedded preview
  try {
    await exiftool.extractPreview(arwPath, cached);
    const st = await fsp.stat(cached);
    if (st.size > 0) return cached;
  } catch {
    // ignore, try fallback
  }

  // 2) Fallback: JPEG from RAW
  await exiftool.extractJpgFromRaw(arwPath, cached);

  const finalStat = await fsp.stat(cached);
  if (!finalStat.size) {
    throw new Error("ARW preview extraction failed (empty output)");
  }

  return cached;
}