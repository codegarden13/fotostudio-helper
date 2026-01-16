// routes/scan.js
//
// POST /api/scan
// Body: { sourceRoot: string }
//
// GET /api/scan/progress
// Response: { active, current, total, message }
//
// Responsibilities:
// - Validate platform + request payload
// - Traverse `sourceRoot` and collect supported *original* image files (RAW + JPEG)
// - Derive a stable timestamp per file (EXIF preferred, filesystem mtime fallback)
// - Publish progress for the UI polling endpoint
//
// Notes:
// - Trash exclusion happens centrally in lib/fsutil.walk() (never enters `.studio-helper-trash`).
// - This route returns a flat `items[]` list only; the client performs session grouping.
// - Timestamp extraction is the slow part; we run it with bounded concurrency.

import path from "path";

import { CONFIG } from "../config.js";
import { walk } from "../lib/fsutil.js";
import { getDateTime } from "../lib/scan.js";
import { setScanProgress, getScanProgress } from "../lib/progress.js";
import { LOG } from "../server.js";

/* ======================================================
   Supported extensions (originals only)
====================================================== */

// Keep this intentionally narrow: these are "session items".
// Companions are resolved separately (import/delete logic).
const RAW_EXTS = new Set([
  ".arw", ".cr2", ".cr3", ".nef", ".raf", ".dng", ".rw2", ".orf", ".pef", ".srw",
]);
const JPEG_EXTS = new Set([".jpg", ".jpeg"]);
const ALLOWED_EXTS = new Set([...RAW_EXTS, ...JPEG_EXTS]);

/* ======================================================
   Error + payload helpers
====================================================== */

function httpError(status, message, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

function sendError(res, err) {
  const status = Number.isInteger(err?.status) ? err.status : 500;
  return res.status(status).json({
    error: "Scan failed",
    details: { error: String(err?.message || err), code: err?.code },
  });
}

function asNonEmptyString(v) {
  const s = String(v ?? "").trim();
  return s || null;
}

/**
 * Normalize the incoming sourceRoot.
 *
 * - Returns an absolute path or null.
 * - Does NOT enforce a global allowlist root; the UI may select arbitrary folders.
 * - `walk()` still enforces existence/readability by throwing if root is invalid.
 */
function normalizeSourceRoot(input) {
  const s = asNonEmptyString(input);
  if (!s) return null;
  return path.resolve(s);
}

/**
 * Clamp scan concurrency to a sane range.
 * - Avoids disk thrash on HDD/USB if someone sets it too high.
 * - Avoids accidental 0/NaN disabling work.
 */
function getScanConcurrency() {
  const raw = Number(CONFIG.scanConcurrency);
  const v = Number.isFinite(raw) ? raw : 8;
  return Math.max(1, Math.min(v, 32));
}

/* ======================================================
   Concurrency utility
====================================================== */

/**
 * Map over `list` with bounded concurrency.
 *
 * - `mapper(item, index)` runs for each item and may throw (caller decides how to handle).
 * - `onProgress(done, total)` is invoked after each item completes (not when it starts).
 *
 * @template T,U
 * @param {T[]} list
 * @param {number} concurrency
 * @param {(item:T, index:number)=>Promise<U>} mapper
 * @param {(done:number, total:number)=>void} [onProgress]
 * @returns {Promise<U[]>}
 */
async function mapWithConcurrency(list, concurrency, mapper, onProgress) {
  const n = Array.isArray(list) ? list.length : 0;
  if (n === 0) return [];

  const c = Math.max(1, Math.min(Number(concurrency) || 1, 32));
  const results = new Array(n);

  let nextIndex = 0;
  let done = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= n) return;

      results[i] = await mapper(list[i], i);

      done++;
      if (typeof onProgress === "function") onProgress(done, n);
    }
  }

  await Promise.all(Array.from({ length: Math.min(c, n) }, () => worker()));
  return results;
}

/* ======================================================
   Route registration
====================================================== */

export function registerScanRoutes(app) {
  /**
   * Start a scan for originals (RAW + JPEG) under `sourceRoot`.
   *
   * Request:
   *   POST /api/scan
   *   Body: { sourceRoot: string }
   *
   * Response:
   *   { ok: true, sourceRoot, items: [{path, ts}], count }
   */
  app.post("/api/scan", async (req, res) => {
    try {
      if (CONFIG.supported === false) {
        throw httpError(
          501,
          CONFIG.unsupportedReason || "Platform not supported",
          "NOT_SUPPORTED"
        );
      }

      const sourceRoot =
        normalizeSourceRoot(req.body?.sourceRoot) ||
        normalizeSourceRoot(CONFIG.sourceRoot);

      if (!sourceRoot) {
        throw httpError(400, "sourceRoot missing", "MISSING_SOURCE_ROOT");
      }

      // Ensure the UI immediately sees an active scan.
      setScanProgress({
        active: true,
        current: 0,
        total: 0,
        message: "Walking folders…",
      });

      // 1) Collect file paths (trash exclusion happens inside walk()).
      const files = await walk(sourceRoot, ALLOWED_EXTS);

      if (!files.length) {
        setScanProgress({ active: false, current: 0, total: 0, message: "Done" });
        LOG.info("[scan] ok (empty)", { sourceRoot });
        return res.json({ ok: true, sourceRoot, items: [], count: 0 });
      }

      setScanProgress({
        active: true,
        current: 0,
        total: files.length,
        message: "Reading timestamps…",
      });

      // 2) Resolve timestamps with bounded concurrency.
      // getDateTime() already has EXIF timeout and filesystem fallback.
      const CONCURRENCY = getScanConcurrency();

      // Progress throttling: UI polls anyway, so avoid spamming shared state.
      const PROGRESS_EVERY = Math.max(10, Math.floor(files.length / 50)); // ~50 updates max
      let lastReported = 0;

      const mapped = await mapWithConcurrency(
        files,
        CONCURRENCY,
        async (filePath) => {
          try {
            const d = await getDateTime(filePath);
            const ts = d?.getTime();
            return Number.isFinite(ts) ? { path: filePath, ts } : null;
          } catch (err) {
            // Skip per-file failures; do not abort a whole scan.
            LOG.warn("[scan] getDateTime failed", { filePath, err: String(err) });
            return null;
          }
        },
        (done, total) => {
          if (done === total || done - lastReported >= PROGRESS_EVERY) {
            lastReported = done;
            setScanProgress({
              active: true,
              current: done,
              total,
              message: "Reading timestamps…",
            });
          }
        }
      );

      const items = mapped.filter(Boolean);

      setScanProgress({
        active: false,
        current: files.length,
        total: files.length,
        message: "Done",
      });

      LOG.info("[scan] ok", { sourceRoot, files: files.length, items: items.length });
      return res.json({ ok: true, sourceRoot, items, count: items.length });
    } catch (err) {
      setScanProgress({ active: false, current: 0, total: 0, message: "Failed" });
      return sendError(res, err);
    }
  });

  /**
   * Progress endpoint for the UI polling loop.
   * Keep it cheap and side-effect free.
   */
  app.get("/api/scan/progress", (req, res) => {
    return res.json(getScanProgress());
  });
}