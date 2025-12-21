// lib/import.js
//
// Responsibilities:
// - Provide safe, reusable import primitives for the server
// - Treat targetRoot as an existing mount (do NOT mkdir targetRoot)
// - Build YYYY/MM/YYYY-MM-DD Title/{originals,exports} under targetRoot
// - Copy files idempotently (skip if already exists)
// - Provide clear errors for non-existent / non-writable roots

import path from "path";
import fs from "fs";
import fsp from "fs/promises";

/* ======================================================
   01) Error helper (stable codes + HTTP-ish status hints)
====================================================== */

function makeErr(message, { code, status, cause } = {}) {
  const err = new Error(message);
  if (code) err.code = code;
  if (status) err.status = status;
  if (cause) err.cause = cause;
  return err;
}

/* ======================================================
   02) Small utilities
====================================================== */

const pad2 = (n) => String(n).padStart(2, "0");

function asTrimmedString(v) {
  return String(v ?? "").trim();
}

function requireNonEmptyString(v, { label, code = "BAD_ARGS", status = 400 } = {}) {
  const s = asTrimmedString(v);
  if (!s) throw makeErr(`${label} is missing`, { code, status });
  return s;
}

/* ======================================================
   03) Root validation (mount-safe)
====================================================== */

/**
 * Ensure targetRoot exists, is a directory, and is writable.
 * IMPORTANT: does not create targetRoot.
 *
 * Errors:
 * - MISSING_ROOT (400)     targetRoot missing/empty
 * - ROOT_NOT_FOUND (409)  not mounted / does not exist
 * - NOT_A_DIRECTORY (409) exists but not a directory
 * - NOT_WRITABLE (403)    exists but not writable
 */
export async function assertWritableRoot(targetRoot) {
  const root = requireNonEmptyString(targetRoot, {
    label: "Target root",
    code: "MISSING_ROOT",
    status: 400,
  });

  let st;
  try {
    st = await fsp.stat(root);
  } catch (cause) {
    throw makeErr(`Target root does not exist (not mounted?): ${root}`, {
      code: "ROOT_NOT_FOUND",
      status: 409,
      cause,
    });
  }

  if (!st.isDirectory()) {
    throw makeErr(`Target root is not a directory: ${root}`, {
      code: "NOT_A_DIRECTORY",
      status: 409,
    });
  }

  try {
    await fsp.access(root, fs.constants.W_OK);
  } catch (cause) {
    throw makeErr(`Target root is not writable: ${root}`, {
      code: "NOT_WRITABLE",
      status: 403,
      cause,
    });
  }

  return root;
}

/* ======================================================
   04) Naming helpers
====================================================== */

export function ymdFromTs(ts) {
  const n = typeof ts === "number" ? ts : Number(ts);
  const d = new Date(n);

  if (Number.isNaN(d.getTime())) return null;

  const yyyy = String(d.getFullYear());
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());

  return { yyyy, mm, dd, ymd: `${yyyy}-${mm}-${dd}` };
}

/**
 * Sanitize a user title for folder names:
 * - trim + collapse whitespace
 * - remove path separators and problematic filesystem chars
 * - keep unicode letters/numbers + a safe punctuation set
 */
export function sanitizeTitle(input, { fallback = "Untitled", maxLen = 80 } = {}) {
  const s = asTrimmedString(input);
  if (!s) return fallback;

  const out = s
    .replace(/\s+/g, " ")
    .replace(/[\/\\]/g, "-")
    .replace(/[:*?"<>|]/g, "")
    .replace(/[^\p{L}\p{N}\s._()-]/gu, "")
    .trim()
    .slice(0, maxLen);

  return out || fallback;
}

/* ======================================================
   05) Folder layout
====================================================== */

/**
 * Build the target folder structure under an existing root:
 *
 *   targetRoot/YYYY/MM/YYYY-MM-DD Title/{originals,exports}
 */
export function buildSessionFolders({ targetRoot, firstImageTs, title }) {
  const root = requireNonEmptyString(targetRoot, {
    label: "buildSessionFolders(): targetRoot",
    code: "MISSING_ROOT",
    status: 400,
  });

  const parts = ymdFromTs(firstImageTs);
  if (!parts) {
    throw makeErr("buildSessionFolders(): invalid firstImageTs", {
      code: "BAD_TIMESTAMP",
      status: 400,
    });
  }

  const safeTitle = sanitizeTitle(title);
  const sessionDirName = `${parts.ymd} ${safeTitle}`.trim();

  const yearDir = path.join(root, parts.yyyy);
  const monthDir = path.join(yearDir, parts.mm);
  const sessionDir = path.join(monthDir, sessionDirName);

  return {
    yearDir,
    monthDir,
    sessionDir,
    originalsDir: path.join(sessionDir, "originals"),
    exportsDir: path.join(sessionDir, "exports"),
    sessionDirName,
    ymd: parts.ymd,
  };
}

/**
 * Create subfolders (year/month/session/originals/exports).
 * NOTE: does not create targetRoot.
 */
export async function ensureSessionFolders(folders) {
  const yearDir = folders?.yearDir;
  const monthDir = folders?.monthDir;
  const originalsDir = folders?.originalsDir;
  const exportsDir = folders?.exportsDir;

  if (!yearDir || !monthDir || !originalsDir || !exportsDir) {
    throw makeErr("ensureSessionFolders(): invalid folders object", {
      code: "BAD_FOLDERS",
      status: 500,
    });
  }

  // mkdir -p style (safe if already exists)
  await fsp.mkdir(yearDir, { recursive: true });
  await fsp.mkdir(monthDir, { recursive: true });
  await fsp.mkdir(originalsDir, { recursive: true });
  await fsp.mkdir(exportsDir, { recursive: true });

  return folders;
}

/* ======================================================
   06) File copy primitive (idempotent)
====================================================== */

/**
 * Copy src -> dst, ensuring the destination directory exists.
 * If dst already exists, skip the copy.
 *
 * Returns:
 *   { copied: true }  if the file was copied
 *   { copied: false } if the destination already existed (skip)
 */
export async function copyFileEnsured(src, dst) {
  const s = requireNonEmptyString(src, { label: "copyFileEnsured(): src", code: "BAD_ARGS", status: 400 });
  const d = requireNonEmptyString(dst, { label: "copyFileEnsured(): dst", code: "BAD_ARGS", status: 400 });

  await fsp.mkdir(path.dirname(d), { recursive: true });

  try {
    await fsp.access(d, fs.constants.F_OK);
    return { copied: false };
  } catch {
    await fsp.copyFile(s, d);
    return { copied: true };
  }
}

/* ======================================================
   07) High-level helper (practical server primitive)
====================================================== */

/**
 * Import a session's items into the proper structure.
 *
 * Copies into: <sessionDir>/originals
 * Creates: year/month/session/originals/exports
 *
 * @param {object} args
 * @param {string} args.targetRoot   existing mount root (e.g. /Volumes/PhotoRaw)
 * @param {number} args.firstImageTs timestamp (ms) of first image in session
 * @param {string} args.title        user title from input
 * @param {Array<{path:string}>|string[]} args.items files to copy (camera paths or strings)
 * @returns {Promise<{folders, copied, skipped}>}
 */
export async function importSessionToTarget({ targetRoot, firstImageTs, title, items }) {
  const root = await assertWritableRoot(targetRoot);

  const folders = buildSessionFolders({
    targetRoot: root,
    firstImageTs,
    title,
  });

  await ensureSessionFolders(folders);

  const list = Array.isArray(items) ? items : [];
  const sorted = list
    .map((it) => (typeof it === "string" ? it : it?.path))
    .filter(Boolean)
    .map((p) => String(p).trim())
    .filter(Boolean)
    .sort();

  let copied = 0;
  let skipped = 0;

  for (const src of sorted) {
    const dst = path.join(folders.originalsDir, path.basename(src));
    const { copied: didCopy } = await copyFileEnsured(src, dst);
    if (didCopy) copied++;
    else skipped++;
  }

  return { folders, copied, skipped };
}