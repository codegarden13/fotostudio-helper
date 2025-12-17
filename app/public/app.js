/**
 * studio-helper / public/app.js
 *
 * Frontend controller for the local Studio Helper web UI.
 *
 * Responsibilities:
 * - Communicate with the local Node backend via /api/*
 * - Render scan results (sessions)
 * - Display a main preview image and a horizontal thumbnail strip
 * - Track and visualize scan progress
 * - Allow safe deletion of images from the camera (server-side move to trash)
 *
 * Backend contract assumptions:
 * - /api/scan returns sessions:
 *   { id, start, end, count, examplePath, exampleName, items[] }
 * - /api/preview returns image/jpeg for ARW (cached embedded preview) and JPG
 * - /api/delete expects: { file: "/absolute/path/on/camera" }
 */

/* ------------------------------------------------------------------ */
/* DOM bindings                                                       */
/* ------------------------------------------------------------------ */

const els = {
  scanBtn: document.getElementById("scanBtn"),
  importBtn: document.getElementById("importBtn"),
  deleteBtn: document.getElementById("deleteBtn"),

  sessions: document.getElementById("sessions"),

  preview: document.getElementById("preview"),
  previewInfo: document.getElementById("previewInfo"),
  thumbStrip: document.getElementById("thumbStrip"),

  title: document.getElementById("title"),
  status: document.getElementById("status"),
  log: document.getElementById("log"),
  progressBar: document.getElementById("progressBar"),
};

// Required elements for core functionality
const REQUIRED = [
  "scanBtn",
  "importBtn",
  "sessions",
  "preview",
  "previewInfo",
  "thumbStrip",
  "title",
  "status",
  "log",
  "progressBar",
];

for (const key of REQUIRED) {
  if (!els[key]) {
    console.error(`Missing required DOM element: #${key}`);
  }
}

if (!els.deleteBtn) {
  console.warn("deleteBtn not found; delete feature disabled.");
}

/* ------------------------------------------------------------------ */
/* State                                                              */
/* ------------------------------------------------------------------ */

// Last scanned sessions (as returned by backend)
let sessions = [];

// Interval handle for /api/scan/progress polling
let progressTimer = null;

// Absolute path of the image currently shown in the main preview
// (used by delete button)
let currentFilePath = null;

/* ------------------------------------------------------------------ */
/* Formatting + small UI helpers                                       */
/* ------------------------------------------------------------------ */

/** Format timestamp (ms) as YYYY-MM-DD HH:MM */
function fmt(ts) {
  const d = new Date(ts);
  return d.toISOString().replace("T", " ").slice(0, 16);
}

function setStatus(text = "") {
  els.status.textContent = text;
}

function setLog(value) {
  els.log.textContent =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

/**
 * Disable/enable buttons while an operation is running
 * to prevent accidental double execution.
 */
function setBusy({ scanning = false, importing = false, deleting = false } = {}) {
  if (els.scanBtn) els.scanBtn.disabled = scanning;
  if (els.importBtn) els.importBtn.disabled = importing;
  if (els.deleteBtn) els.deleteBtn.disabled = deleting;
}

/** Reset all UI elements related to a scan. */
function resetUIForScan() {
  setLog("");
  setStatus("");

  els.sessions.innerHTML = "";
  els.thumbStrip.innerHTML = "";

  els.preview.removeAttribute("src");
  els.previewInfo.textContent = "";

  sessions = [];
  currentFilePath = null;

  // Progress bar starts indeterminate
  els.progressBar.max = 100;
  els.progressBar.removeAttribute("value");
}

/* ------------------------------------------------------------------ */
/* Backend interaction                                                 */
/* ------------------------------------------------------------------ */

/**
 * Ask the backend whether a camera is connected.
 * Returns the camera label or null.
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

function renderSessions(list) {
  els.sessions.innerHTML = "";

  list.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent =
      `${String(s.id).padStart(2, "0")} | ` +
      `${fmt(s.start)} – ${fmt(s.end)} | ${s.count} files`;
    els.sessions.appendChild(opt);
  });
}

function getSelectedSession() {
  const idx = els.sessions.selectedIndex;
  if (idx < 0 || idx >= sessions.length) return null;
  return sessions[idx];
}

/* ------------------------------------------------------------------ */
/* Preview + thumbnails                                                */
/* ------------------------------------------------------------------ */

function clearThumbnails() {
  els.thumbStrip.innerHTML = "";
}

function highlightThumbnail(activeImg) {
  Array.from(els.thumbStrip.children).forEach((el) =>
    el.classList.remove("border-primary")
  );
  activeImg.classList.add("border-primary");
}

/**
 * Update the main preview and keep currentFilePath in sync.
 */
function setCurrentImage(filePath) {
  currentFilePath = filePath || null;

  if (!filePath) {
    els.preview.removeAttribute("src");
    els.previewInfo.textContent = "";
    return;
  }

  els.preview.src = `/api/preview?path=${encodeURIComponent(filePath)}`;
  els.previewInfo.textContent = `Example: ${filePath.split("/").pop()}`;
}

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
    setCurrentImage(filePath);
    highlightThumbnail(img);
  };

  return img;
}

function showPreviewForSelected() {
  const s = getSelectedSession();
  if (!s) return;

  setCurrentImage(s.examplePath);

  els.preview.onerror = () => {
    els.previewInfo.textContent =
      `Example: ${s.exampleName || "(unknown)"} | preview failed (see Network → /api/preview)`;
  };

  clearThumbnails();

  if (!Array.isArray(s.items)) return;

  s.items.forEach((filePath, idx) => {
    const thumb = createThumbnail(filePath, idx === 0);
    if (thumb) els.thumbStrip.appendChild(thumb);
  });
}

/* ------------------------------------------------------------------ */
/* Delete current image                                                */
/* ------------------------------------------------------------------ */

async function deleteCurrentImage() {
  if (!els.deleteBtn) return;

  const s = getSelectedSession();
  if (!s) return alert("No session selected.");
  if (!currentFilePath) return alert("No image selected.");

  const name = currentFilePath.split("/").pop();
  if (!confirm(`Delete (move to camera trash): ${name} ?`)) return;

  setBusy({ deleting: true });

  try {
    const res = await fetch("/api/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: currentFilePath }),
    });

    const data = await res.json();
    if (!res.ok) {
      setLog(data);
      return;
    }

    // Update session state locally
    s.items = s.items.filter((p) => p !== currentFilePath);
    s.count = s.items.length;

    if (s.examplePath === currentFilePath) {
      s.examplePath = s.items[0] || null;
      s.exampleName = s.examplePath ? s.examplePath.split("/").pop() : "";
    }

    currentFilePath = s.items[0] || null;

    const keepIdx = els.sessions.selectedIndex;
    renderSessions(sessions);
    els.sessions.selectedIndex = keepIdx;

    if (s.items.length) {
      showPreviewForSelected();
    } else {
      clearThumbnails();
      els.preview.removeAttribute("src");
      els.previewInfo.textContent = "Session is empty.";
    }

    setLog(`Deleted (moved to trash): ${name}\nMoved to: ${data.movedTo}`);
  } catch (err) {
    setLog(String(err));
  } finally {
    setBusy({ deleting: false });
  }
}

/* ------------------------------------------------------------------ */
/* Scan progress                                                       */
/* ------------------------------------------------------------------ */

function startProgressPolling() {
  stopProgressPolling();

  progressTimer = setInterval(async () => {
    try {
      const res = await fetch("/api/scan/progress", { cache: "no-store" });
      const p = await res.json();

      if (!p || p.total <= 0) {
        els.progressBar.removeAttribute("value");
        return;
      }

      if (!els.progressBar.hasAttribute("value")) {
        els.progressBar.value = 0;
      }

      els.progressBar.value = Math.round((p.current / p.total) * 100);

      if (!p.active) stopProgressPolling();
    } catch {
      // non-fatal; keep UI responsive
    }
  }, 250);
}

function stopProgressPolling() {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
}

/* ------------------------------------------------------------------ */
/* Actions: scan + import                                              */
/* ------------------------------------------------------------------ */

async function runScan() {
  resetUIForScan();

  const cam = await checkCamera();
  if (!cam) return;

  setStatus("Scanning…");
  setBusy({ scanning: true });
  startProgressPolling();

  try {
    const res = await fetch("/api/scan", { method: "POST" });
    const data = await res.json();

    if (!res.ok) {
      setStatus("Scan error");
      setLog(data);
      return;
    }

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
    setBusy({ scanning: false });
  }
}

async function runImport() {
  const s = getSelectedSession();
  if (!s) return alert("No session selected.");

  setBusy({ importing: true });

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
    setBusy({ importing: false });
  }
}

/* ------------------------------------------------------------------ */
/* Event wiring                                                        */
/* ------------------------------------------------------------------ */

els.scanBtn.addEventListener("click", runScan);
els.sessions.addEventListener("change", showPreviewForSelected);
els.importBtn.addEventListener("click", runImport);
els.deleteBtn?.addEventListener("click", deleteCurrentImage);

// Initial status
checkCamera();