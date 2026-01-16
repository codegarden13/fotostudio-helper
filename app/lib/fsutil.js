// lib/fsutil.js

import fs from "fs";
import path from "path";
import fsp from "fs/promises";
import crypto from "crypto";
import { CONFIG } from "../config.js";

/* ======================================================
   Small path helpers
====================================================== */

/**
 * Return the lower-case extension for a path.
 * Example: "/a/b/DSC01234.ARW" -> ".arw"
 */
export function extOf(p) {
  return path.extname(String(p ?? "")).toLowerCase();
}

/**
 * Replace problematic filename characters and trim.
 * Used for folder/session naming (import).
 */
export function safeName(name) {
  return String(name ?? "Untitled")
    .replace(/[<>:"/\\|?*\n\r\t]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Best-effort exists check.
 */
export async function exists(p) {
  try {
    await fsp.access(String(p ?? ""));
    return true;
  } catch {
    return false;
  }
}

/* ======================================================
   Cache helpers
====================================================== */

/**
 * Compute deterministic cache path for a preview file.
 * Required by lib/preview.js.
 */
export function previewCachePath(srcPath) {
  const key = crypto
    .createHash("sha1")
    .update(String(srcPath ?? ""))
    .digest("hex");
  return path.join(CONFIG.previewCacheDir, `${key}.jpg`);
}

/* ======================================================
   Directory filtering
====================================================== */

/**
 * Canonical global noise filter used by walk() and directory listings.
 *
 * Policy:
 * - Skip hidden files/dirs (dot-prefixed)
 * - Skip known system junk
 * - Skip the app trash folder everywhere
 */
export function shouldSkipDirentName(name) {
  const n = String(name ?? "").trim();
 if (!n) return true;

  // Hidden (Finder-like). This includes .DS_Store, .AppleDouble, etc.
  if (n.startsWith(".")) return true;

  // Common junk folder
  if (n === "__MACOSX") return true;

  // Windows volume noise
  if (n === "System Volume Information") return true;

  // App trash (redundant because dot, but explicit for clarity)
  if (n === ".studio-helper-trash") return true;

  return false;
}

/* ======================================================
   FS primitives
====================================================== */

/**
 * Ensure a directory exists (mkdir -p).
 */
export async function ensureDir(dirPath) {
  const p = String(dirPath ?? "").trim();
  if (!p) {
    const e = new Error("ensureDir(): dirPath is empty");
    e.code = "BAD_ARGS";
    throw e;
  }
  await fsp.mkdir(p, { recursive: true });
}

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
 * - `.studio-helper-trash` is never entered or scanned (at any depth)
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

  // Root must exist + be a directory
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
      // unreadable subdirectory -> skip silently
      continue;
    }

    for (const entry of entries) {
      const name = entry.name;

      // Canonical skip rule (covers .studio-helper-trash everywhere)
      if (shouldSkipDirentName(name)) continue;

      const fullPath = path.join(dir, name);

      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;

      const ext = extOf(fullPath);
      if (allowedExts.has(ext)) results.push(fullPath);
    }
  }

  return results;
}