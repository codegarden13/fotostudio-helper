// app/config.js
//
// Goals:
// - Single source of truth (CONFIG) with clear defaults per platform
// - macOS + Linux supported; Windows explicitly unsupported (but app can still start)
// - Minimal, predictable ENV overrides (trimmed + optional)
// - Camera profiles are immutable and validated via helpers

import os from "os";
import path from "path";

/* ======================================================
   01) Platform + support
====================================================== */

export const PLATFORM = os.platform(); // "darwin" | "linux" | "win32" | ...

export const SUPPORTED_PLATFORMS = Object.freeze(["darwin", "linux"]);

export function isSupportedPlatform(platform = PLATFORM) {
  return SUPPORTED_PLATFORMS.includes(platform);
}

function safeUsername() {
  try {
    return os.userInfo().username || "";
  } catch {
    return "";
  }
}

const USERNAME = safeUsername();

/* ======================================================
   02) Env helpers
====================================================== */

function envString(name) {
  const v = process.env[name];
  return typeof v === "string" ? v.trim() : "";
}

/* ======================================================
   03) Camera profiles
====================================================== */

const SONY_RAW_EXTS = Object.freeze([".arw"]);

export const CAMERA_PROFILES = Object.freeze({
  SonyA9III: Object.freeze({ brand: "sony", exts: new Set(SONY_RAW_EXTS) }),
  SonyA7R: Object.freeze({ brand: "sony", exts: new Set(SONY_RAW_EXTS) }),
});

/* ======================================================
   04) Defaults (per platform)
====================================================== */

function defaultTargetRootFor(platform) {
  switch (platform) {
    case "darwin":
      return "/Volumes/PhotoRaw";
    case "linux":
      return "/mnt/PhotoRaw";
    default:
      // Windows/unknown: intentionally empty -> routes can return 501 where needed
      return "";
  }
}

function defaultVolumeRootsFor(platform, username) {
  if (platform === "darwin") return ["/Volumes"];

  if (platform === "linux") {
    const roots = [
      username && `/run/media/${username}`,
      username && `/media/${username}`,
      "/run/media",
      "/media",
      "/mnt",
    ].filter(Boolean);

    // de-dupe while preserving order
    return Array.from(new Set(roots));
  }

  return [];
}

function defaultPreviewCacheDir() {
  // Keep it inside OS temp to avoid permission surprises (esp. Linux)
  return path.join(os.tmpdir(), "studio-helper-previews");
}

function unsupportedReasonFor(platform) {
  if (platform === "win32") {
    return "Windows is not supported. This app requires mounted volumes (macOS/Linux).";
  }
  if (!isSupportedPlatform(platform)) {
    return `Platform not supported: ${platform}`;
  }
  return null;
}

/* ======================================================
   05) CONFIG (single source of truth)
====================================================== */

const envTargetRoot = envString("STUDIO_TARGET_ROOT");
const envPreviewCache = envString("STUDIO_PREVIEW_CACHE");

const supported = isSupportedPlatform(PLATFORM);

export const CONFIG = Object.freeze({
  platform: PLATFORM,

  supported,
  unsupportedReason: supported ? null : unsupportedReasonFor(PLATFORM),

  // Import destination root (must exist/mounted; do not auto-create)
  targetRoot: (envTargetRoot || defaultTargetRootFor(PLATFORM)).trim(),

  // Where to search for removable/mounted volumes (camera + other sources)
  volumeRoots: Object.freeze(defaultVolumeRootsFor(PLATFORM, USERNAME)),

  // Camera detection + scan filtering
  allowedCameras: Object.freeze(Object.keys(CAMERA_PROFILES)),
  dcimFolder: "DCIM",

  // Session grouping
  sessionGapMinutes: 30,

  // Preview caching
  previewCacheDir: (envPreviewCache || defaultPreviewCacheDir()).trim(),
});

/* ======================================================
   06) Helpers
====================================================== */

export function getCameraProfile(label) {
  return CAMERA_PROFILES[label] ?? null;
}

export function getAllowedExtsForCamera(label) {
  const profile = getCameraProfile(label);
  if (!profile) throw new Error(`Unknown camera label: ${label}`);
  if (!(profile.exts instanceof Set)) throw new Error(`Invalid extension set for camera: ${label}`);
  return profile.exts;
}