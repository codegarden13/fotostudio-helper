import express from "express";
import { exiftool } from "exiftool-vendored";

import { registerCameraRoutes } from "./routes/camera.js";
import { registerScanRoutes } from "./routes/scan.js";
import { registerPreviewRoutes } from "./routes/preview.js";
import { registerImportRoutes } from "./routes/import.js";

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

// Routes
registerCameraRoutes(app);
registerScanRoutes(app);
registerPreviewRoutes(app);
registerImportRoutes(app);

// Start
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`find me on http://localhost:${PORT}`);
});

// Clean shutdown
process.on("SIGINT", async () => {
  await exiftool.end();
  process.exit(0);
});