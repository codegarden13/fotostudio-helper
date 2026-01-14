// routes/target.js
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { CONFIG } from "../config.js";

const execFileAsync = promisify(execFile);

function platform() {
  return os.platform(); // darwin | linux | win32
}
function isMac() {
  return platform() === "darwin";
}
function isLinux() {
  return platform() === "linux";
}

async function statSafe(p) {
  try {
    const st = await fs.stat(p);
    return { ok: true, st };
  } catch (e) {
    return { ok: false, err: e };
  }
}//#TODO: Fuction is not used

async function isWritableDir(p) {
  try {
    const st = await fs.stat(p);
    if (!st.isDirectory()) return { exists: true, isDir: false, writable: false };

    await fs.access(p, fsSync.constants.W_OK);
    return { exists: true, isDir: true, writable: true };
  } catch (e) {
    if (e?.code === "ENOENT") return { exists: false, isDir: false, writable: false };
    if (e?.code === "EACCES") return { exists: true, isDir: true, writable: false };
    return { exists: false, isDir: false, writable: false, error: String(e) };
  }
}

export function registerTargetRoutes(app) {
  // Pollable target status
  app.get("/api/target/status", async (_req, res) => {
    const root = String(CONFIG.targetRoot || "").trim();
    if (!root) {
      return res.status(500).json({
        ok: false,
        path: "",
        exists: false,
        writable: false,
        supported: false,
        reason: "CONFIG.targetRoot is empty",
      });
    }

    const supported = isMac() || isLinux();
    if (!supported) {
      return res.status(501).json({
        ok: false,
        path: root,
        exists: false,
        writable: false,
        supported: false,
        reason: `Platform not supported: ${platform()}`,
      });
    }

    const s = await isWritableDir(root);

    return res.json({
      ok: true,
      path: root,
      exists: s.exists,
      isDir: s.isDir,
      writable: s.writable,
      // helpful for UI messaging / debugging
      platform: platform(),
      error: s.error || null,
    });
  });

  // Optional helper: open Finder (macOS) / file manager (Linux)
  app.post("/api/target/open", async (_req, res) => {
    try {
      const root = String(CONFIG.targetRoot || "").trim();
      const smbUrl = CONFIG.targetSmbUrl; // optional
      const fallback = root || (isMac() ? "/Volumes" : "/mnt");
      const target = smbUrl && typeof smbUrl === "string" ? smbUrl : fallback;

      if (isMac()) {
        await execFileAsync("open", [target]);
        return res.json({ ok: true, opened: target });
      }

      if (isLinux()) {
        // Try xdg-open (works on most desktop Linux)
        await execFileAsync("xdg-open", [target]);
        return res.json({ ok: true, opened: target });
      }

      return res.status(501).json({
        ok: false,
        error: "target open not supported on this platform",
        details: { platform: platform() },
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "open failed", details: String(err) });
    }
  });
}