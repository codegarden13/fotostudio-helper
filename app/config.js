// app/config.js
//
// Goals:
// - Single source of truth (CONFIG)
// - macOS + Linux supported
// - No camera- or DCIM-dependency
// - Source folders are scanned recursively
// - Camera is derived from image metadata (EXIF/XMP), not config

import os from "os";
import path from "path";

/* ======================================================
   01) Platform + support
====================================================== */

export const PLATFORM = os.platform(); // "darwin" | "linux" | "win32"
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
   03) Defaults (per platform)
====================================================== */

function defaultTargetRootFor(platform) {
  switch (platform) {
    case "darwin":
      return "/Volumes/PhotoRaw";
    case "linux":
      return "/mnt/PhotoRaw";
    default:
      return "";
  }
}

function defaultSourceRootFor(platform, username) {
  switch (platform) {
    case "darwin":
      // sensible default: user pictures folder
      return path.join("/Users", username, "Pictures");
    case "linux":
      return username
        ? path.join("/home", username, "Pictures")
        : "/home";
    default:
      return "";
  }
}

function defaultPreviewCacheDir() {
  return path.join(os.tmpdir(), "studio-helper-previews");
}

function unsupportedReasonFor(platform) {
  if (platform === "win32") {
    return "Windows is not supported. This app requires POSIX filesystem semantics.";
  }
  if (!isSupportedPlatform(platform)) {
    return `Platform not supported: ${platform}`;
  }
  return null;
}

/* ======================================================
   04) Image / source scanning defaults
====================================================== */

// All extensions the scanner treats as primary images
// (companions are handled elsewhere)
const DEFAULT_IMAGE_EXTENSIONS = Object.freeze([
  // RAW
  ".arw", ".cr2", ".cr3", ".nef", ".dng", ".orf", ".rw2",
  // JPEG
  ".jpg", ".jpeg",
]);

/* ======================================================
   05) CONFIG (single source of truth)
====================================================== */
//#TODO:Wird das genutzt
const envTargetRoot = envString("STUDIO_TARGET_ROOT");
const envSourceRoot = envString("STUDIO_SOURCE_ROOT");
const envPreviewCache = envString("STUDIO_PREVIEW_CACHE");
const supported = isSupportedPlatform(PLATFORM);

export const CONFIG = Object.freeze({
  platform: PLATFORM,

  supported,
  unsupportedReason: supported ? null : unsupportedReasonFor(PLATFORM),

  /* --------------------------------------------------
     Import destination (NAS / archive)
     -------------------------------------------------- */

  // Must exist and be writable; never auto-created
  targetRoot: (envTargetRoot || defaultTargetRootFor(PLATFORM)).trim(),

  /* --------------------------------------------------
     Import source (scan root)
     -------------------------------------------------- */

  // Arbitrary folder; NOT required to be a mounted camera
  sourceRoot: (envSourceRoot || defaultSourceRootFor(PLATFORM, USERNAME)).trim(),

  sourceScan: Object.freeze({
    recursive: true,          // walk subfolders
    followSymlinks: false,    // safety first
    maxDepth: 32,             // hard guard against runaway trees
    imageExtensions: Object.freeze(DEFAULT_IMAGE_EXTENSIONS),
  }),

  /* --------------------------------------------------
     Session grouping
     -------------------------------------------------- */
  // Minutes between images that start a new session
  sessionGapMinutes: 30,

  /* --------------------------------------------------
     Preview caching
     -------------------------------------------------- */
  previewCacheDir: (envPreviewCache || defaultPreviewCacheDir()).trim(),
});

/* ======================================================
   06) Helpers
====================================================== */

export function isImageExtension(ext) {
  if (!ext) return false;
  return CONFIG.sourceScan.imageExtensions.includes(ext.toLowerCase());
}