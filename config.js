export const CAMERA_PROFILES = {
  SonyA9III: { brand: "sony", exts: new Set([".arw"]) },
  SonyA7R:   { brand: "sony", exts: new Set([".arw"]) },
};

export const CONFIG = {
  targetRoot: "/Volumes/PhotoRaw",
  allowedCameras: ["SonyA9III", "SonyA7R"],
  dcimFolder: "DCIM",
  sessionGapMinutes: 30,
  previewCacheDir: "/tmp/studio-helper-previews",
  volumesRoot: "/Volumes", // macOS for now; keep centralized
};