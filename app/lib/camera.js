// lib/camera.js
//
// Responsibilities:
// - Detect a mounted camera volume by name under known volume roots
// - Validate camera profile
// - Return a consistent shape used by /api/camera and /api/scan
//
// Returns: { label, mountPoint, dcimPath, profile } | null

import path from "path";
import { CONFIG, CAMERA_PROFILES } from "../config.js";
import { exists } from "./fsutil.js";



function isNonEmptyString(x) {
  return typeof x === "string" && x.trim().length > 0;
}

function uniqStrings(list) {
  const out = [];
  const seen = new Set();
  for (const v of list || []) {
    const s = String(v || "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function getProfileOrThrow(label) {
  const profile = CAMERA_PROFILES[label];
  if (!profile?.exts || typeof profile.exts.has !== "function") {
    const err = new Error(`Invalid or missing camera profile for ${label}`);
    err.code = "BAD_CAMERA_PROFILE";
    err.status = 500;
    throw err;
  }
  return profile;
}

export async function detectCamera() {
  const allowed = Array.isArray(CONFIG.allowedCameras) ? CONFIG.allowedCameras : [];
  const roots = uniqStrings(CONFIG.volumeRoots);

  if (!allowed.length) return null;

  // If volumeRoots is empty/misconfigured, fail loudly (this is a config bug)
  if (!roots.length) {
    const err = new Error("CONFIG.volumeRoots is empty/missing (cannot detect mounted cameras)");
    err.code = "BAD_VOLUME_ROOTS";
    err.status = 500;
    throw err;
  }

  for (const nameRaw of allowed) {
    const name = String(nameRaw || "").trim();
    if (!name) continue;

    const profile = getProfileOrThrow(name);

    for (const root of roots) {
      if (!isNonEmptyString(root)) continue;

      const mountPoint = path.join(root, name);
      const dcimPath = path.join(mountPoint, CONFIG.dcimFolder || "DCIM");

      if (await exists(dcimPath)) {
        return { label: name, mountPoint, dcimPath, profile };
      }
    }
  }

  return null;
}