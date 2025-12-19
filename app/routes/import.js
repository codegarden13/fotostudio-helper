// routes/import.js
import path from "path";
import crypto from "crypto";
import fs from "fs/promises";

import { CONFIG } from "../config.js";
import { safeName } from "../lib/fsutil.js";
import { copyFileEnsured } from "../lib/import.js";

/* ======================================================
   Helpers
   ====================================================== */

function pad2(n) {
  return String(n).padStart(2, "0");
}

function makeSessionId(date) {
  // Unique and sortable-ish: S-YYYYMMDD-HHMMSS-xxxx
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mi = pad2(date.getMinutes());
  const ss = pad2(date.getSeconds());
  const rnd = crypto.randomBytes(2).toString("hex");
  return `S-${yyyy}${mm}${dd}-${hh}${mi}${ss}-${rnd}`;
}

function toYmdParts(date) {
  const yyyy = String(date.getFullYear());
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  return { yyyy, mm, dd, day: `${yyyy}-${mm}-${dd}` };
}

function midpointDate(start, end) {
  return new Date((start.getTime() + end.getTime()) / 2);
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function appendLog(logFile, line) {
  await fs.appendFile(logFile, `${line}\n`, "utf8");
}

function normalizeTitle(sessionTitle) {
  return safeName(sessionTitle || "").trim();
}

function parseDateOrThrow(value, label) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    const err = new Error(`Invalid ${label}`);
    err.status = 400;
    throw err;
  }
  return d;
}

function buildDestDir({ targetRoot, dateForPath, sessionId, title }) {
  const { yyyy, mm, day } = toYmdParts(dateForPath);
  const dayFolder = title ? `${day}_${sessionId}_${title}` : `${day}_${sessionId}`;
  return path.join(targetRoot, yyyy, mm, dayFolder);
}

/* ======================================================
   Routes
   ====================================================== */

/**
 * POST /api/import
 *
 * Expected payload:
 * {
 *   sessionTitle: string,
 *   sessionStart: number | string (timestamp),
 *   sessionEnd: number | string (timestamp),   // Option A (midpoint)
 *   files: string[] (absolute source paths)
 * }
 *
 * Behavior:
 * - Uses midpoint of sessionStart/sessionEnd for YYYY/MM/DD placement
 * - Creates: <targetRoot>/YYYY/MM/YYYY-MM-DD_<ID>_<Title?>
 * - Copies files into folder, skipping existing
 * - Writes log into folder: .import.log
 */
export function registerImportRoutes(app) {
  app.post("/api/import", async (req, res) => {
    try {
      const { sessionTitle, sessionStart, sessionEnd, files } = req.body || {};

      if (!Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ error: "No files" });
      }

      const title = normalizeTitle(sessionTitle);
      const start = parseDateOrThrow(sessionStart, "sessionStart");

      // Option A: midpoint policy (if sessionEnd missing, fall back to start)
      const end = sessionEnd ? parseDateOrThrow(sessionEnd, "sessionEnd") : start;
      const mid = midpointDate(start, end);

      const sessionId = makeSessionId(start);
      const destDir = buildDestDir({
        targetRoot: CONFIG.targetRoot,
        dateForPath: mid,
        sessionId,
        title,
      });

      await ensureDir(destDir);

      const logFile = path.join(destDir, ".import.log");
      const sortedFiles = [...files].sort();

      await appendLog(logFile, `IMPORT START   ${new Date().toISOString()}`);
      await appendLog(logFile, `destDir:       ${destDir}`);
      await appendLog(logFile, `sessionTitle:  ${sessionTitle || ""}`);
      await appendLog(logFile, `sessionStart:  ${start.toISOString()}`);
      await appendLog(logFile, `sessionEnd:    ${end.toISOString()}`);
      await appendLog(logFile, `sessionMid:    ${mid.toISOString()}`);
      await appendLog(logFile, `sessionId:     ${sessionId}`);
      await appendLog(logFile, `fileCount:     ${sortedFiles.length}`);
      await appendLog(logFile, ``);

      let copied = 0;
      let skipped = 0;

      for (const src of sortedFiles) {
        const dst = path.join(destDir, path.basename(src));

        if (await exists(dst)) {
          skipped++;
          await appendLog(logFile, `SKIP exists   ${src} -> ${dst}`);
          continue;
        }

        await copyFileEnsured(src, dst);
        copied++;
        await appendLog(logFile, `COPIED        ${src} -> ${dst}`);
      }

      await appendLog(logFile, ``);
      await appendLog(logFile, `RESULT copied=${copied} skipped=${skipped}`);
      await appendLog(logFile, `IMPORT END     ${new Date().toISOString()}`);

      res.json({ ok: true, destDir, logFile, sessionId, copied, skipped });
    } catch (err) {
      const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
      res.status(status).json({ error: String(err?.message || err) });
    }
  });
}