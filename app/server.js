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

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

/* ------------------------------------------------------------------ */
/* Logger                                                             */
/* ------------------------------------------------------------------ */
/**
 * NOTE:
 * Your createServerLogger implementation (as pasted earlier) expects:
 *   { logsDir, baseName, alsoConsole }
 * If your local implementation still expects { dir, prefix }, adjust either:
 * - here (recommended), OR
 * - add aliases inside createServerLogger.
 */
export const LOG = createServerLogger({
  logsDir: "./logs",
  baseName: "studio-helper",
  alsoConsole: true,
});

// IMPORTANT: open logfile immediately (top-level await is OK in ESM)
await LOG.init?.();

/* ------------------------------------------------------------------ */
/* App + middleware                                                    */
/* ------------------------------------------------------------------ */

const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

// Access log -> logfile (+ console if enabled)
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - t0;
    LOG.info?.("[http]", {
      status: res.statusCode,
      method: req.method,
      url: req.originalUrl,
      ms,
    });
  });
  next();
});

// UI/browser log ingestion (public/logger.js posts here)
if (typeof LOG.ingestUiLogs === "function") {
  app.post("/api/log", LOG.ingestUiLogs);
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

registerConfigRoutes(app);
registerCameraRoutes(app);
registerExposureRoutes(app);
registerScanRoutes(app);
registerPreviewRoutes(app);
registerImportRoutes(app);
registerDeleteRoutes(app);
registerTargetRoutes(app);

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

const server = app.listen(PORT, () => {
  LOG.info?.(`studio-helper running on http://localhost:${PORT}`);
});

/* ------------------------------------------------------------------ */
/* Shutdown + hard error handling                                      */
/* ------------------------------------------------------------------ */

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  try {
    LOG.warn?.("shutdown begin", { signal });

    // Stop accepting new connections
    await new Promise((resolve) => server.close(resolve));
    LOG.info?.("http server closed");

    // Terminate exiftool child process
    await exiftool.end();
    LOG.info?.("exiftool ended");

    // Close logfile stream (if implemented)
    await LOG.close?.();
    LOG.info?.("logger closed");
  } catch (err) {
    // Keep this as console too (in case logger is broken)
    console.error("Shutdown error:", err);
    LOG.error?.("shutdown error", { err: String(err) });
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("unhandledRejection", (err) => {
  console.error("Unhandled promise rejection:", err);
  LOG.error?.("unhandledRejection", { err: String(err) });
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  LOG.error?.("uncaughtException", { err: String(err) });
  // Optional: exit fast on uncaught exceptions
  shutdown("uncaughtException");
});