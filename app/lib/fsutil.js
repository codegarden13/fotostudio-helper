// lib/fsutil.js
//
// Responsibilities:
// - Small filesystem helpers (pure-ish, reusable)
// - Naming normalization (safeName)
// - Preview cache path computation
// - Generic directory traversal (walk)
//
// Notes:
// - Keep app-specific policy out of walk() as much as possible.
// - For app-wide skip rules, use shouldSkipDirentName() + opts.skipDirNames.

import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import crypto from "crypto";
import { CONFIG } from "../config.js";


/* ======================================================
   Small helpers
====================================================== */

export function extOf(p) {
  return path.extname(String(p ?? "")).toLowerCase();
}

/**
 * Existence check (doesn't distinguish between permission denied vs missing).
 */
export async function exists(p) {
  try {
    await fsp.access(String(p ?? ""));
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dirPath) {
  const p = String(dirPath ?? "").trim();
  if (!p) throw new Error("ensureDir(): dirPath is empty");
  await fsp.mkdir(p, { recursive: true });
}

/**
 * Produce a filesystem-friendly name.
 * - removes illegal path characters
 * - collapses whitespace
 * - trims trailing dots/spaces (macOS Finder-like)
 */
export function safeName(name, { fallback = "Untitled", maxLen = 120 } = {}) {
  const s = String(name ?? "").trim();
  const base = s || fallback;

  const out = base
    .replace(/[<>:"/\\|?*\n\r\t]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/g, "") // avoid trailing dots/spaces
    .slice(0, maxLen);

  return out || fallback;
}

export function previewCachePath(srcPath) {
  const key = crypto.createHash("sha1").update(String(srcPath ?? "")).digest("hex");
  return path.join(CONFIG.previewCacheDir, `${key}.jpg`);
}

/* ======================================================
   Traversal defaults
====================================================== */

/**
 * Global noise filter used by walk() and other directory listings.
 * Keep this conservative: only skip things you never want to see/scan.
 */
export function shouldSkipDirentName(name) {
  const n = String(name ?? "");
  if (!n) return true;

  // Always skip dotfiles/dirs and macOS metadata
  if (n.startsWith(".")) return true;
  if (n === ".DS_Store") return true;
  if (n === ".AppleDouble") return true;
  if (n === "._.DS_Store") return true;

  // Your app trash folder (critical: prevents re-scanning trashed items)
  if (n === ".studio-helper-trash") return true;

  // Common junk
  if (n === "__MACOSX") return true;

  return false;
}

//import { extOf, shouldSkipDirentName } from "./fsutil.js";

/* ======================================================
   Walk
====================================================== */

/**
 * Walk a directory tree iteratively and return all files matching `allowedExts`.
 *
 * Behavior:
 * - Root must exist, be a directory, and be readable (otherwise throws)
 * - Unreadable subdirectories are skipped (scan continues)
 * - Hidden files / system noise / app trash are ALWAYS skipped
 * - `.studio-helper-trash` is never entered or scanned
 *
 * @param {string} rootDir
 * @param {Set<string>} allowedExts - lower-case extensions, e.g. new Set([".arw", ".jpg"])
 * @returns {Promise<string[]>} absolute file paths
 */
export async function walk(rootDir, allowedExts) {
  if (!allowedExts || typeof allowedExts.has !== "function") {
    const e = new Error("walk(): allowedExts must be a Set");
    e.code = "BAD_ARGS";
    throw e;
  }

  const root = path.resolve(String(rootDir ?? "").trim());
  if (!root) {
    const e = new Error("walk(): rootDir is empty");
    e.code = "BAD_ARGS";
    throw e;
  }

  // Root must exist + be directory
  let st;
  try {
    st = await fsp.stat(root);
  } catch (err) {
    const e = new Error(`walk(): rootDir does not exist: ${root}`);
    e.code = err?.code || "ENOENT";
    e.cause = err;
    throw e;
  }

  if (!st.isDirectory()) {
    const e = new Error(`walk(): rootDir is not a directory: ${root}`);
    e.code = "NOT_A_DIRECTORY";
    throw e;
  }

  // Root must be readable (avoid silent empty scans)
  try {
    await fsp.access(root, fs.constants.R_OK);
  } catch (err) {
    const e = new Error(`walk(): rootDir not accessible (permissions?): ${root}`);
    e.code = err?.code || "EACCES";
    e.cause = err;
    throw e;
  }

  const results = [];
  const stack = [root];

  while (stack.length) {
    const dir = stack.pop();

    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      // unreadable subdirectory → skip silently
      continue;
    }

    for (const entry of entries) {
      const name = entry.name;

      // ONE canonical skip rule (includes .studio-helper-trash)
      if (shouldSkipDirentName(name)) continue;

      const fullPath = path.join(dir, name);

      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;

      const ext = extOf(fullPath);
      if (allowedExts.has(ext)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}