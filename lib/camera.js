import path from "path";
import { CONFIG, CAMERA_PROFILES } from "../config.js";
import { exists } from "./fsutil.js";

export async function detectCamera() {
  for (const name of CONFIG.allowedCameras) {
    const mountPoint = path.join(CONFIG.volumesRoot, name);
    const dcimPath = path.join(mountPoint, CONFIG.dcimFolder);

    if (await exists(dcimPath)) {
      const profile = CAMERA_PROFILES[name];
      if (!profile?.exts || typeof profile.exts.has !== "function") {
        throw new Error(`Invalid or missing camera profile for ${name}`);
      }
      return { label: name, mountPoint, dcimPath, profile };
    }
  }
  return null;
}