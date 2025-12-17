import path from "path";
import { CONFIG } from "../config.js";
import { safeName } from "../lib/fsutil.js";
import { copyFileEnsured } from "../lib/import.js";

/**
 * Registers routes responsible for importing image sessions
 * into the server-defined target archive.
 *
 * Responsibilities:
 * - Validate import requests
 * - Create a session folder using date + user-provided title
 * - Copy images into the destination, skipping existing files
 *
 * The client does NOT control the target root; this is enforced
 * server-side via CONFIG.targetRoot.
 */
export function registerImportRoutes(app) {
  /**
   * POST /api/import
   *
   * Expected payload:
   * {
   *   sessionTitle: string,
   *   sessionStart: number | string (timestamp),
   *   files: string[] (absolute source paths)
   * }
   *
   * Behavior:
   * - Creates a folder: YYYY-MM-DD <sessionTitle>
   * - Copies all files into that folder
   */
  app.post("/api/import", async (req, res) => {
    const { sessionTitle, sessionStart, files } = req.body || {};

    // Basic validation: we need at least one file to import
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "No files" });
    }

    try {
      // Sanitize user-provided title for filesystem safety
      const title = safeName(sessionTitle);

      // Normalize session start time
      const start = new Date(sessionStart);

      // Build destination folder name:
      // YYYY-MM-DD <Title>
      const folder =
        `${start.getFullYear()}-` +
        `${String(start.getMonth() + 1).padStart(2, "0")}-` +
        `${String(start.getDate()).padStart(2, "0")} ` +
        title;

      // Final destination directory is always under the configured target root
      const destDir = path.join(CONFIG.targetRoot, folder);

      // Copy each file into the destination folder
      for (const src of files) {
        const dst = path.join(destDir, path.basename(src));
        await copyFileEnsured(src, dst);
      }

      // Report success and final destination path
      res.json({ ok: true, destDir });
    } catch (err) {
      // Catch-all for filesystem or unexpected errors
      res.status(500).json({ error: String(err) });
    }
  });
}