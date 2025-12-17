import express from "express";
import { exiftool } from "exiftool-vendored";

import { registerCameraRoutes } from "./routes/camera.js";
import { registerScanRoutes } from "./routes/scan.js";
import { registerPreviewRoutes } from "./routes/preview.js";
import { registerImportRoutes } from "./routes/import.js";
import { registerDeleteRoutes } from "./routes/delete.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const app = express();

// Middleware
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

// Routes
registerCameraRoutes(app);
registerScanRoutes(app);
registerPreviewRoutes(app);
registerImportRoutes(app);
registerDeleteRoutes(app);

// Start
const server = app.listen(PORT, () => {
  console.log(`studio-helper running on http://localhost:${PORT}`);
});

// Shutdown handling (Ctrl+C, docker stop, etc.)
async function shutdown(signal) {
  try {
    console.log(`\nShutting down (${signal})...`);
    server.close(() => console.log("HTTP server closed."));
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