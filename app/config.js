// app/config.js
// Central, shared configuration (no Express here).

const sonyRawExts = [".arw"];

/**
 * Camera profiles:
 * - brand: used for any brand-specific behavior
 * - exts: allowed file extensions for scanning on that camera
 */
export const CAMERA_PROFILES = Object.freeze({
  SonyA9III: Object.freeze({ brand: "sony", exts: new Set(sonyRawExts) }),
  SonyA7R:   Object.freeze({ brand: "sony", exts: new Set(sonyRawExts) }),
});

/**
 * App configuration (server-side source of truth).
 */
export const CONFIG = Object.freeze({
  // Import destination root (default workflow)
  targetRoot: "/Volumes/PhotoRaw",

  // Camera detection
  allowedCameras: Object.freeze(["SonyA9III", "SonyA7R"]),
  dcimFolder: "DCIM",
  volumesRoot: "/Volumes", // macOS for now

  // Session grouping
  sessionGapMinutes: 30,

  // Preview caching
  previewCacheDir: "/tmp/studio-helper-previews",
});

/**
 * Helper: Get a camera profile for a label (or null if unknown).
 */
export function getCameraProfile(label) {
  return CAMERA_PROFILES[label] || null;
}

/**
 * Helper: Get allowed extensions for a camera label.
 * Throws early if misconfigured.
 */
export function getAllowedExtsForCamera(label) {
  const profile = getCameraProfile(label);
  if (!profile?.exts || typeof profile.exts.has !== "function") {
    throw new Error(`Invalid or missing camera profile for ${label}`);
  }
  return profile.exts;
}