import path from "path";
import fsp from "fs/promises";
import crypto from "crypto";
import { CONFIG } from "../config.js";

export function extOf(p) {
  return path.extname(p).toLowerCase();
}

export async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

export async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

export function safeName(name) {
  return (name || "Untitled")
    .replace(/[<>:"/\\|?*\n\r\t]/g, "_")
    .trim();
}

export function previewCachePath(srcPath) {
  const key = crypto.createHash("sha1").update(srcPath).digest("hex");
  return path.join(CONFIG.previewCacheDir, `${key}.jpg`);
}