import path from "path";
import fs from "fs";
import fsp from "fs/promises";

export async function copyFileEnsured(src, dst) {
  await fsp.mkdir(path.dirname(dst), { recursive: true });
  try {
    await fsp.access(dst, fs.constants.F_OK);
    return; // skip existing
  } catch {
    await fsp.copyFile(src, dst);
  }
}