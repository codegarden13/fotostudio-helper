// app/server.js
//
// Server entrypoint
// - Express app + route registration
// - Server logfile per start (via createServerLogger)
// - HTTP access logging to logfile
// - UI log ingestion endpoint: POST /api/log
// - Graceful shutdown (server close + exiftool end)

import express from "express";
import { exiftool } from "exiftool-vendored";

import { registerCameraRoutes } from "./routes/camera.js";
import { registerExposureRoutes } from "./routes/exposure.js";
import { registerScanRoutes } from "./routes/scan.js";
import { registerPreviewRoutes } from "./routes/preview.js";
import { registerImportRoutes } from "./routes/import.js";
import { registerDeleteRoutes } from "./routes/delete.js";
import { registerConfigRoutes } from "./routes/config.js";
import { registerTargetRoutes } from "./routes/target.js";

import { createServerLogger } from "./lib/logger.js";

/* ------------------------------------------------------------------ */
/* Config                                                             */
/* ------------------------------------------------------------------ */

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = "public";
const LOGS_DIR = "./logs";

/* ------------------------------------------------------------------ */
/* Logger (single instance for whole process)                          */
/* ------------------------------------------------------------------ */

export const LOG = createServerLogger({
  logsDir: LOGS_DIR,
  baseName: "studio-helper",
  alsoConsole: true,
});

await LOG.init();

// ✅ make logger available to simple helpers (e.g. logLine())
global.__SERVER_LOGGER__ = LOG;

/* ------------------------------------------------------------------ */
/* App + middleware                                                    */
/* ------------------------------------------------------------------ */

const app = express();

// Parse JSON first (needed for /api/log and others)
app.use(express.json({ limit: "2mb" }));

// Static files
app.use(express.static(PUBLIC_DIR));

// Access log -> logfile (+ console if enabled)
app.use((req, res, next) => {
  const t0 = Date.now();

  res.on("finish", () => {
    const ms = Date.now() - t0;
    LOG.info("[http]", {
      status: res.statusCode,
      method: req.method,
      url: req.originalUrl,
      ms,
    });
  });

  next();
});

// UI/browser log ingestion (optional)
if (typeof LOG.ingestUiLogs === "function") {
  app.post("/api/log", LOG.ingestUiLogs);
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

function registerRoutes(app) {
  registerConfigRoutes(app);
  registerCameraRoutes(app);
  registerExposureRoutes(app);
  registerScanRoutes(app);
  registerPreviewRoutes(app);
  registerImportRoutes(app);
  registerDeleteRoutes(app);
  registerTargetRoutes(app);
}

registerRoutes(app);

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

const server = app.listen(PORT, () => {
  LOG.info("server started", { url: `http://localhost:${PORT}` });
});

/* ------------------------------------------------------------------ */
/* Shutdown                                                            */
/* ------------------------------------------------------------------ */

let shuttingDown = false;

async function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;

  // Always try to log; also mirror to console in case streams are busted.
  console.log(`[shutdown] begin (${reason})`);
  LOG.warn("shutdown begin", { reason });

  try {
    // Stop accepting new connections
    await new Promise((resolve) => server.close(resolve));
    LOG.info("http server closed");

    // Terminate exiftool child process
    await exiftool.end();
    LOG.info("exiftool ended");

    // Close logfile stream
    await LOG.close();
    console.log("[shutdown] logger closed");
  } catch (err) {
    console.error("[shutdown] error:", err);
    try {
      LOG.error("shutdown error", { err: String(err?.stack || err) });
    } catch {
      // ignore (logger may be dead)
    }
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("unhandledRejection", (err) => {
  console.error("[process] unhandledRejection:", err);
  LOG.error("unhandledRejection", { err: String(err?.stack || err) });
});

process.on("uncaughtException", (err) => {
  console.error("[process] uncaughtException:", err);
  try {
    LOG.error("uncaughtException", { err: String(err?.stack || err) });
  } finally {
    shutdown("uncaughtException");
  }
});