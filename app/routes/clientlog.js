// app/routes/clientlog.js
import os from "os";

function clampStr(s, max = 2000) {
  const x = String(s ?? "");
  return x.length > max ? x.slice(0, max) + " …(truncated)" : x;
}

export function registerClientLogRoutes(app, { logger }) {
  if (!logger) throw new Error("registerClientLogRoutes(): missing logger");

  app.post("/api/log", expressJsonCompat(), (req, res) => {
    try {
      // Expect: { level?: "info"|"warn"|"error", msg: string, meta?: any, ts?: string }
      const level = String(req.body?.level || "info").toLowerCase();
      const msg = clampStr(req.body?.msg, 2000);
      const meta = req.body?.meta;

      const record = {
        kind: "client",
        host: os.hostname(),
        ua: clampStr(req.headers["user-agent"], 200),
      };

      if (level === "error") logger.error("[client]", msg, record, meta ?? "");
      else if (level === "warn") logger.warn("[client]", msg, record, meta ?? "");
      else logger.info("[client]", msg, record, meta ?? "");

      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false });
    }
  });
}

/**
 * #TODO:Check server for that, it should be there
 * If your server already has `app.use(express.json())`, you can delete this
 * and use nothing here. This is only to make this route self-contained.
 */
function expressJsonCompat() {
  return (req, _res, next) => {
    // already parsed?
    if (req.body && typeof req.body === "object") return next();

    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        req.body = raw ? JSON.parse(raw) : {};
      } catch {
        req.body = {};
      }
      next();
    });
  };
}