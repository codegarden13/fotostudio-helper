/**
 * studio-helper / public/app.js
 *
 * Responsibilities:
 * - Talk to the local Node backend via /api/*
 * - Render sessions, preview image, and horizontally scrollable thumbnails
 * - Show scan progress (indeterminate → determinate) by polling /api/scan/progress
 *
 * Assumptions:
 * - Backend returns sessions with: { id, start, end, count, examplePath, exampleName, items[] }
 * - /api/preview returns image/jpeg for ARW (via cached embedded preview) and JPG
 */

/* ------------------------------------------------------------------ */
/* DOM bindings                                                       */
/* ------------------------------------------------------------------ */

const els = {
  scanBtn: document.getElementById("scanBtn"),
  importBtn: document.getElementById("importBtn"),
  sessions: document.getElementById("sessions"),
  preview: document.getElementById("preview"),
  previewInfo: document.getElementById("previewInfo"),
  thumbStrip: document.getElementById("thumbStrip"),
  title: document.getElementById("title"),
  status: document.getElementById("status"),
  log: document.getElementById("log"),
  progressBar: document.getElementById("progressBar"),
};

// Fail fast if required elements are missing (saves debugging time).
const REQUIRED = [
  "scanBtn", "importBtn", "sessions", "preview", "previewInfo",
  "thumbStrip", "title", "status", "log", "progressBar"
];
for (const key of REQUIRED) {
  if (!els[key]) console.error(`Missing required DOM element: #${key}`);
}

/* ------------------------------------------------------------------ */
/* State                                                             */
/* ------------------------------------------------------------------ */

let sessions = [];           // Last scanned sessions
let progressTimer = null;    // setInterval handle for progress polling

/* ------------------------------------------------------------------ */
/* Formatting + UI helpers                                             */
/* ------------------------------------------------------------------ */

/** Format timestamp (ms) as YYYY-MM-DD HH:MM (UTC-ish ISO substring). */
function fmt(ts) {
  const d = new Date(ts);
  return d.toISOString().replace("T", " ").slice(0, 16);
}

/** Update status line. */
function setStatus(text) {
  els.status.textContent = text || "";
}

/** Write to log area; accepts string or object (pretty JSON). */
function setLog(objOrText) {
  els.log.textContent =
    typeof objOrText === "string"
      ? objOrText
      : JSON.stringify(objOrText, null, 2);
}

/** Reset UI for a fresh scan. */
function resetUIForScan() {
  setLog("");
  els.sessions.innerHTML = "";
  els.preview.removeAttribute("src");
  els.previewInfo.textContent = "";
  els.thumbStrip.innerHTML = "";
  sessions = [];

  // Start scan progress in indeterminate mode:
  // <progress> without a "value" attribute shows the moving indicator.
  els.progressBar.max = 100;
  els.progressBar.removeAttribute("value");
}

/* ------------------------------------------------------------------ */
/* Backend interaction                                                 */
/* ------------------------------------------------------------------ */

/**
 * Check if a camera is connected. Backend determines the mountpoint/camera.
 * Returns camera label or null if no camera.
 */
async function checkCamera() {
  const res = await fetch("/api/camera", { cache: "no-store" });
  const data = await res.json();

  if (!data.connected) {
    setStatus("No camera connected");
    return null;
  }

  setStatus(`Camera: ${data.label}`);
  return data.label;
}

/* ------------------------------------------------------------------ */
/* Sessions list                                                       */
/* ------------------------------------------------------------------ */

/** Render the <select> list with sessions. */
function renderSessions(list) {
  els.sessions.innerHTML = "";

  list.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent =
      `${String(s.id).padStart(2, "0")} | ${fmt(s.start)} – ${fmt(s.end)} | ${s.count} files`;
    els.sessions.appendChild(opt);
  });
}

/** Return currently selected session object or null. */
function getSelectedSession() {
  const idx = els.sessions.selectedIndex;
  if (idx < 0 || idx >= sessions.length) return null;
  return sessions[idx];
}

/* ------------------------------------------------------------------ */
/* Preview + thumbnail strip                                           */
/* ------------------------------------------------------------------ */

/** Remove all thumbnails from the horizontal strip. */
function clearThumbnails() {
  els.thumbStrip.innerHTML = "";
}

/** Highlight the active thumbnail (Bootstrap border-primary). */
function highlightThumbnail(activeImg) {
  Array.from(els.thumbStrip.children).forEach((el) =>
    el.classList.remove("border-primary")
  );
  activeImg.classList.add("border-primary");
}

/**
 * Create a clickable thumbnail <img>.
 * Returns a DOM node (or null if filePath is invalid).
 */
function createThumbnail(filePath, isActive = false) {
  if (!filePath) return null;

  const img = document.createElement("img");
  img.src = `/api/preview?path=${encodeURIComponent(filePath)}`;
  img.className = "img-thumbnail";
  img.style.height = "96px";
  img.style.cursor = "pointer";
  img.style.objectFit = "cover";

  if (isActive) img.classList.add("border-primary");

  img.onclick = () => {
    els.preview.src = img.src;
    els.previewInfo.textContent = `Example: ${filePath.split("/").pop()}`;
    highlightThumbnail(img);
  };

  return img;
}

/**
 * Show main preview + filename and render horizontal thumbnails for the session.
 * Uses /api/preview for both main image and thumbnails.
 */
function showPreviewForSelected() {
  const s = getSelectedSession();
  if (!s) return;

  // Main preview
  els.preview.src = `/api/preview?path=${encodeURIComponent(s.examplePath)}`;
  els.previewInfo.textContent = `Example: ${s.exampleName || "(unknown)"}`;

  // If the backend returns an error for /api/preview, <img> cannot show it;
  // onerror provides a clear hint to check Network tab.
  els.preview.onerror = () => {
    els.previewInfo.textContent =
      `Example: ${s.exampleName || "(unknown)"} | preview failed (see Network → /api/preview)`;
  };

  // Thumbnails
  clearThumbnails();

  if (!Array.isArray(s.items)) return;

  s.items.forEach((filePath, idx) => {
    const thumb = createThumbnail(filePath, idx === 0);
    if (thumb) els.thumbStrip.appendChild(thumb);
  });
}

/* ------------------------------------------------------------------ */
/* Progress polling                                                    */
/* ------------------------------------------------------------------ */

/**
 * Poll /api/scan/progress and update <progress>.
 * - Indeterminate while total <= 0 (e.g., directory walk not finished)
 * - Determinate once total > 0 (value grows 0..100)
 */
function startProgressPolling() {
  stopProgressPolling();

  progressTimer = setInterval(async () => {
    try {
      const res = await fetch("/api/scan/progress", { cache: "no-store" });
      const p = await res.json();

      // Still discovering files or no totals available → indeterminate.
      if (!p || p.total <= 0) {
        els.progressBar.removeAttribute("value");
        return;
      }

      // Switch to determinate once.
      if (!els.progressBar.hasAttribute("value")) {
        els.progressBar.value = 0;
      }

      const percent = Math.round((p.current / p.total) * 100);
      els.progressBar.value = Math.max(0, Math.min(100, percent));

      // Stop polling when scan ends.
      if (!p.active) stopProgressPolling();
    } catch (err) {
      console.error("Progress polling failed:", err);
    }
  }, 250);
}

/** Stop progress polling interval. */
function stopProgressPolling() {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
}

/* ------------------------------------------------------------------ */
/* Actions: scan + import                                              */
/* ------------------------------------------------------------------ */

/** Run scan: call /api/scan, render sessions, show first preview. */
async function runScan() {
  resetUIForScan();

  const cam = await checkCamera();
  if (!cam) return;

  setStatus("Scanning…");
  els.scanBtn.disabled = true;
  startProgressPolling();

  try {
    const res = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const data = await res.json();

    if (!res.ok) {
      setStatus("Scan error");
      setLog(data);
      return;
    }

    // Finish progress: force determinate and set to 100%.
    if (!els.progressBar.hasAttribute("value")) els.progressBar.value = 0;
    els.progressBar.value = 100;

    sessions = data.sessions || [];
    renderSessions(sessions);

    setStatus(`${sessions.length} sessions`);

    if (sessions.length) {
      els.sessions.selectedIndex = 0;
      showPreviewForSelected();
    }
  } catch (err) {
    setStatus("Scan error");
    setLog(String(err));
  } finally {
    stopProgressPolling();
    els.scanBtn.disabled = false;
  }
}

/** Import currently selected session to server-defined target. */
async function runImport() {
  const s = getSelectedSession();
  if (!s) {
    alert("No session selected.");
    return;
  }

  els.importBtn.disabled = true;

  try {
    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionTitle: els.title.value.trim(),
        sessionStart: s.start,
        files: s.items,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      setLog(data);
      return;
    }

    setLog(`OK\nTarget: ${data.destDir}`);
  } catch (err) {
    setLog(String(err));
  } finally {
    els.importBtn.disabled = false;
  }
}

/* ------------------------------------------------------------------ */
/* Wire events                                                        */
/* ------------------------------------------------------------------ */

els.scanBtn.addEventListener("click", runScan);
els.sessions.addEventListener("change", showPreviewForSelected);
els.importBtn.addEventListener("click", runImport);

// Initial status on load
checkCamera();