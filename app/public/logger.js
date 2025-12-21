// public/logger.js
//
// UI logger + optional server mirroring (best-effort).
//
// Contract:
// - logLine(...) writes to UI
// - if mirrorToServer: queues/batches and POSTs to /api/log
// - setLog(value) replaces UI content AND mirrors those lines as well

export function createLogger({
  el,
  endpoint = "/api/log",
  flushEveryMs = 500,
  maxBatch = 20,
  mirrorToServer = true,
} = {}) {
  let seq = 0;
  const queue = [];
  let flushTimer = null;

  const toStr = (v) => {
    if (typeof v === "string") return v;
    try { return JSON.stringify(v); } catch { return String(v); }
  };

  const stamp = () => new Date().toISOString().slice(11, 19); // HH:MM:SS

  function writeUiLine(line) {
    if (!el) return;
    el.textContent += line + "\n";
    el.scrollTop = el.scrollHeight;
  }

  function replaceUi(text) {
    if (!el) return;
    el.textContent = text || "";
    el.scrollTop = el.scrollHeight;
  }

  function enqueue(level, msg, meta) {
    seq++;
    queue.push({
      level: String(level || "info"),
      msg: String(msg ?? ""),
      meta: meta ?? null,
      ts: new Date().toISOString(),
      seq,
    });

    if (!flushTimer) flushTimer = setTimeout(flush, flushEveryMs);
  }

  async function flush() {
    flushTimer = null;
    if (!mirrorToServer || queue.length === 0) return;

    const batch = queue.splice(0, maxBatch);

    try {
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        cache: "no-store",
        body: JSON.stringify({ batch }),
      });
    } catch {
      // best-effort: drop silently (do not spam UI)
    }

    if (queue.length) flushTimer = setTimeout(flush, flushEveryMs);
  }

  function logLine(...parts) {
    const msg = parts.map(toStr).join(" ");
    const line = `[${stamp()}] ${msg}`;
    writeUiLine(line);

    if (mirrorToServer) enqueue("info", msg, null);
  }

  function log(level, msg, meta) {
    const m = toStr(msg);
    const line = `[${stamp()}] ${m}`;
    writeUiLine(line);

    if (mirrorToServer) enqueue(level || "info", m, meta ?? null);
  }

  // IMPORTANT: setLog is for “replace log window content”, not “append”
  // We still mirror it to server as lines so it ends up in the logfile too.
  function setLog(value) {
    const text =
      typeof value === "string"
        ? value
        : (() => {
            try { return JSON.stringify(value, null, 2); } catch { return String(value); }
          })();

    replaceUi(text);

    if (mirrorToServer) {
      const lines = text.split("\n").map((l) => l.trimEnd()).filter(Boolean);
      for (const l of lines.slice(0, 200)) enqueue("info", `[setLog] ${l}`, null);
    }
  }

  return { logLine, log, setLog, flush };
}