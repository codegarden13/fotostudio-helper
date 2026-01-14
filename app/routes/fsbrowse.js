// routes/fsbrowse.js
//
// Responsibilities:
// - GET /api/fs/browse?path=...
// - Return child directories for a given path (non-recursive)
// - "Finder-like" entry points via virtual ROOTS
// - Defensive error handling (stable, JSON-serializable error details)
// - Hide dot-directories by default (Finder-like), optional showHidden=1

import os from "os";
import path from "path";
import fsp from "fs/promises";

/* ------------------------------------------------------
   Error helpers (stable + JSON serializable)
------------------------------------------------------ */

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = "BAD_REQUEST";
  return err;
}

function errToJson(err) {
  return {
    message: err?.message || String(err),
    code: err?.code,
    errno: err?.errno,
    syscall: err?.syscall,
    path: err?.path,
  };
}

function sendBrowseError(res, err) {
  const code = err?.code || err?.cause?.code;

  const status =
    Number.isInteger(err?.status) ? err.status :
    code === "ENOENT" ? 404 :
    code === "EACCES" || code === "EPERM" ? 403 :
    500;

  return res.status(status).json({
    error: "Source folder browse failed",
    details: errToJson(err),
  });
}

/* ------------------------------------------------------
   macOS "expected places"
------------------------------------------------------ */

const PLATFORM = os.platform(); // "darwin" | "linux" | ...
const HOME = os.homedir();

const DARWIN_ICLOUD = path.join(
  HOME,
  "Library",
  "Mobile Documents",
  "com~apple~CloudDocs"
);

// Internal virtual marker. Must never be path-resolved.
const VROOTS = "__ROOTS__";

/* ------------------------------------------------------
   Token resolution / normalization
------------------------------------------------------ */

function resolveToken(p) {
  const s = String(p || "").trim();
  if (!s) return "";

  const u = s.toUpperCase();

  // Virtual root: show shortcuts as "directories"
  if (u === "ROOTS") return VROOTS;

  // Backwards compatible tokens you already used
  if (u === "USER_HOME") return HOME;
  if (u === "USER_HOME_PICTURES") return path.join(HOME, "Pictures");
  if (u === "USER_HOME_DESKTOP") return path.join(HOME, "Desktop");
  if (u === "USER_HOME_DOCUMENTS") return path.join(HOME, "Documents");
  if (u === "USER_HOME_DOWNLOADS") return path.join(HOME, "Downloads");
  if (u === "USER_ICLOUD") return PLATFORM === "darwin" ? DARWIN_ICLOUD : "";

  // New simple tokens
  switch (u) {
    case "HOME": return HOME;
    case "PICTURES": return path.join(HOME, "Pictures");
    case "DESKTOP": return path.join(HOME, "Desktop");
    case "DOCUMENTS": return path.join(HOME, "Documents");
    case "DOWNLOADS": return path.join(HOME, "Downloads");
    case "VOLUMES": return PLATFORM === "darwin" ? "/Volumes" : "/mnt";
    case "ICLOUD": return PLATFORM === "darwin" ? DARWIN_ICLOUD : "";
    default: return s; // treat as literal path
  }
}

function expandTilde(p) {
  const s = String(p || "").trim();
  if (!s) return s;
  if (s === "~") return HOME;
  if (s.startsWith("~/")) return path.join(HOME, s.slice(2));
  return s;
}

function normalizeBasePath(rawQueryPath) {
  let p = resolveToken(rawQueryPath);
  p = expandTilde(p);

  if (!p) return "";

  // IMPORTANT: do not path.resolve the virtual roots marker
  if (p === VROOTS) return VROOTS;

  if (p.includes("\0")) throw badRequest("Invalid path");
  return path.resolve(p);
}

async function existsDir(p) {
  try {
    const st = await fsp.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

/* ------------------------------------------------------
   Directory listing (Finder-like)
------------------------------------------------------ */

function isHiddenName(name) {
  return typeof name === "string" && name.startsWith(".");
}

async function listDirs(basePath, { showHidden = false } = {}) {
  const entries = await fsp.readdir(basePath, { withFileTypes: true });

  return entries
    .filter((e) => {
      if (!e.isDirectory()) return false;
      if (!showHidden && isHiddenName(e.name)) return false; // hide dot-folders by default
      return true;
    })
    .map((e) => ({ name: e.name, path: path.join(basePath, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

async function buildShortcuts() {
  const candidates = [
    { name: "Home", path: HOME },
    { name: "Desktop", path: path.join(HOME, "Desktop") },
    { name: "Downloads", path: path.join(HOME, "Downloads") },
    { name: "Documents", path: path.join(HOME, "Documents") },
    { name: "Pictures", path: path.join(HOME, "Pictures") },
  ];

  if (PLATFORM === "darwin") {
    candidates.push(
      { name: "iCloud Drive", path: DARWIN_ICLOUD },
      { name: "Volumes", path: "/Volumes" }
    );
  }

  // Only show those that actually exist
  const out = [];
  for (const c of candidates) {
    if (await existsDir(c.path)) out.push(c);
  }
  return out;
}

/* ------------------------------------------------------
   Route registration
------------------------------------------------------ */

export function registerFsBrowseRoutes(app) {
  app.get("/api/fs/browse", async (req, res) => {
    try {
      const q = String(req.query?.path ?? "").trim();
      const showHidden = String(req.query?.showHidden ?? "") === "1";

      // Empty path -> ROOTS (shortcuts)
      const basePath = normalizeBasePath(q || "ROOTS");

      // Virtual ROOTS view: return shortcuts as directories
      if (basePath === VROOTS) {
        const shortcuts = await buildShortcuts();
        return res.json({
          ok: true,
          platform: PLATFORM,
          path: "ROOTS",
          parent: null,
          directories: shortcuts,   // UI can render these as normal dirs
          shortcuts,                // optional duplicate for clarity
        });
      }

      // Normal browsing
      const st = await fsp.stat(basePath);
      if (!st.isDirectory()) throw badRequest(`Not a directory: ${basePath}`);

      const directories = await listDirs(basePath, { showHidden });
      const parent = basePath === path.parse(basePath).root ? null : path.dirname(basePath);

      const shortcuts = await buildShortcuts();

      return res.json({
        ok: true,
        platform: PLATFORM,
        path: basePath,
        parent,
        directories,
        shortcuts,
      });
    } catch (err) {
      return sendBrowseError(res, err);
    }
  });
}