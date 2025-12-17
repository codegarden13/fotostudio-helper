import path from "path";
import fsp from "fs/promises";
import { exiftool } from "exiftool-vendored";
import { extOf } from "./fsutil.js";

export async function walk(dir, allowedExts) {
  if (!allowedExts || typeof allowedExts.has !== "function") {
    throw new Error("walk(): allowedExts must be a Set");
  }

  const out = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });

  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p, allowedExts));
    else if (allowedExts.has(extOf(p))) out.push(p);
  }
  return out;
}

export async function getDateTime(filePath) {
  try {
    const tags = await exiftool.read(filePath);
    const dt = tags.DateTimeOriginal || tags.CreateDate || tags.ModifyDate;
    if (dt?.toJSDate) return dt.toJSDate();
  } catch {
    // ignore EXIF failures
  }
  const st = await fsp.stat(filePath);
  return st.mtime;
}