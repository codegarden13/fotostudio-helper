// app/lib/logger.js
//
// Server logger:
// - creates a new logfile on each server start
// - writes logs to file (+ optionally console)
// - provides an Express handler for /api/log that accepts UI log batches

import path from "path";
import fs from "fs";
import fsp from "fs/promises";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function fileStamp(d = new Date()) {
  // 2025-12-20_11-55-25
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
}

function safeJson(x) {
  if (typeof x === "string") return x;
  try { return JSON.stringify(x); } catch { return String(x); }
}

export function createServerLogger({
  logsDir = "./logs",
  baseName = "server",
  alsoConsole = true,
} = {}) {
  const startedAt = new Date();
  const fileName = `${baseName}_${fileStamp(startedAt)}.log`;
  const filePath = path.resolve(logsDir, fileName);

  let stream = null;

  async function init() {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    stream = fs.createWriteStream(filePath, { flags: "a" });

    writeRaw(`=== ${baseName} start ${startedAt.toISOString()} ===`);
    writeRaw(`logFile: ${filePath}`);
  }

  function writeRaw(line) {
    const out = `${line}\n`;
    if (alsoConsole) process.stdout.write(out);
    if (stream) stream.write(out);
  }

  function stamp() {
    return new Date().toISOString();
  }

  function log(level, msg, meta = null) {
    const lvl = String(level || "info").toUpperCase();
    const m = String(msg ?? "");
    const line = meta == null
      ? `[${stamp()}] ${lvl} ${m}`
      : `[${stamp()}] ${lvl} ${m} ${safeJson(meta)}`;
    writeRaw(line);
  }

  function info(msg, meta) { log("info", msg, meta); }
  function warn(msg, meta) { log("warn", msg, meta); }
  function error(msg, meta) { log("error", msg, meta); }

  // Express handler for UI batches: { batch: [{level,msg,meta,ts,seq}, ...] }
  function ingestUiLogs(req, res) {
    try {
      const batch = Array.isArray(req.body?.batch) ? req.body.batch : [];
      for (const item of batch.slice(0, 200)) {
        const level = item?.level || "info";
        const msg = item?.msg || "";
        const meta = item?.meta ?? null;
        log(level, `UI ${msg}`, meta);
      }
      res.json({ ok: true });
    } catch (e) {
      error("[api/log] ingest failed", String(e));
      res.status(500).json({ ok: false });
    }
  }

  async function close() {
    if (!stream) return;
    writeRaw(`=== ${baseName} stop ${new Date().toISOString()} ===`);
    await new Promise((resolve) => stream.end(resolve));
    stream = null;
  }

  return { init, close, filePath, log, info, warn, error, ingestUiLogs };
}