import express from "express";
import { exiftool } from "exiftool-vendored";

// Detects connected cameras, exposes camera identity and availability to the UI
import { registerCameraRoutes } from "./routes/camera.js";
//exif
import { registerExposureRoutes } from "./routes/exposure.js";



// Scans the camera filesystem, groups images into time-based sessions,
// and reports scan progress and session metadata
import { registerScanRoutes } from "./routes/scan.js";

// Serves image previews to the UI (embedded RAW previews and JPEG files),
// including caching and format-specific handling
import { registerPreviewRoutes } from "./routes/preview.js";

// Handles importing sessions into the target archive or export directories,
// applying naming conventions and destination logic
import { registerImportRoutes } from "./routes/import.js";

// Allows safe removal of images from the camera during culling,
// restricted to the detected camera mount and supported file types
import { registerDeleteRoutes } from "./routes/delete.js";

// Exposes read-only server configuration required by the UI
// (e.g. default target root and workflow-related settings)
import { registerConfigRoutes } from "./routes/config.js";

/* ------------------------------------------------------------------ */
/* App initialization                                                  */
/* ------------------------------------------------------------------ */

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const app = express();

// Middleware
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

/* ------------------------------------------------------------------ */
/* Routes (must be registered AFTER app is initialized)                */
/* ------------------------------------------------------------------ */

registerConfigRoutes(app);
registerCameraRoutes(app);
registerExposureRoutes(app);
registerScanRoutes(app);
registerPreviewRoutes(app);
registerImportRoutes(app);
registerDeleteRoutes(app);

/* ------------------------------------------------------------------ */
/* Start                                                              */
/* ------------------------------------------------------------------ */

const server = app.listen(PORT, () => {
  console.log(`studio-helper running on http://localhost:${PORT}`);
});

/* ------------------------------------------------------------------ */
/* Shutdown handling (Ctrl+C, docker stop, etc.)                       */
/* ------------------------------------------------------------------ */

async function shutdown(signal) {
  try {
    console.log(`\nShutting down (${signal})...`);

    // Stop accepting new connections
    await new Promise((resolve) => server.close(resolve));
    console.log("HTTP server closed.");

    // Ensure exiftool child process is terminated
    await exiftool.end();
  } catch (err) {
    console.error("Shutdown error:", err);
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("unhandledRejection", (err) => {
  console.error("Unhandled promise rejection:", err);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});