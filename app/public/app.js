/**
 * studio-helper / public/app.js
 *
 * Single-file frontend controller (structured, “modular within one file”).
 *
 * Responsibilities:
 * - Load server config (/api/config) and render target UI
 * - Poll camera connection (/api/camera) every 2s with countdown display
 * - Scan filesystem (/api/scan) and receive raw items [{path, ts}]
 * - Compute gap presets from data and drive the gap slider
 * - Group raw items into sessions client-side (gap slider)
 * - Render session list, meta info, preview + thumbnails
 * - Delete current image and keep the current session selected
 * - Poll scan progress and update progress bar
 */

/* ======================================================
   01) CONFIG / CONSTANTS
   ====================================================== */

const APP = {
  PROGRESS_POLL_MS: 250,

  // Camera poll
  CAMERA_POLL_MS: 2000,              // hit /api/camera every 2s
  CAMERA_COUNTDOWN_TICK_MS: 250,     // update countdown label 4x/sec

  // Gap preset generation
  GAP_PRESET_STEPS: 11,
  GAP_PRESET_TOP_K: 6,
  GAP_MIN_FLOOR_MS: 1000,

  // Slider fallback (usable before first scan)
  FALLBACK_GAP_PRESETS_MS: [
    5_000,
    15_000,
    30_000,
    60_000,
    5 * 60_000,
    30 * 60_000,
    2 * 60 * 60_000,
  ],
};

console.log("[app.js] loaded", new Date().toISOString());

/* ======================================================
   02) DOM BINDINGS
   ====================================================== */

const els = {
  // Controls
  scanBtn: document.getElementById("scanBtn"),
  importBtn: document.getElementById("importBtn"),
  deleteBtn: document.getElementById("deleteBtn"),

  // Target
  currentDestRoot: document.getElementById("currentDestRoot"),
  currentDestInline: document.getElementById("currentDestInline"),
  destModeHint: document.getElementById("destModeHint"),
  chooseDestBtn: document.getElementById("chooseDestBtn"),
  resetDestBtn: document.getElementById("resetDestBtn"),

  // Camera status
  cameraAlert: document.getElementById("cameraAlert"),
  cameraPollCountdown: document.getElementById("cameraPollCountdown"),

  // Gap slider
  gapSlider: document.getElementById("gapSlider"),
  gapValue: document.getElementById("gapValue"),
  gapLegend: document.getElementById("gapLegend"),

  // Sessions + preview
  sessions: document.getElementById("sessions"),
  preview: document.getElementById("preview"),
  previewInfo: document.getElementById("previewInfo"),
  thumbStrip: document.getElementById("thumbStrip"),

  // Meta
  metaStart: document.getElementById("metaStart"),
  metaEnd: document.getElementById("metaEnd"),
  metaCount: document.getElementById("metaCount"),
  metaExample: document.getElementById("metaExample"),

  // Misc
  title: document.getElementById("title"),
  status: document.getElementById("status"),
  log: document.getElementById("log"),
  progressBar: document.getElementById("progressBar"),
};

/* ======================================================
   03) STATE
   ====================================================== */

const state = {
  // Raw scan output (sorted by ts ASC)
  scanItems: [],

  // Derived sessions
  sessions: [],

  // Current image in preview
  currentFilePath: null,

  // Busy flags
  busy: { scanning: false, importing: false, deleting: false },

  // Scan progress polling
  progressTimer: null,

  // Camera polling
  cameraPollTimer: null,

  cameraCheckInFlight: false,
  cameraLast: { connected: false, label: "" },

  cameraLastCheckAtMs: 0,   // timestamp of last /api/camera request
  cameraElapsedTimer: null,// UI ticker

  cameraWaitSinceMs: 0, // startet, wenn camera disconnected erkannt wird

  // Import target
  defaultTargetRoot: null,
  currentTargetRoot: null,

  // Gap slider model
  gapPresetsMs: [],
  gapPresetIndex: 0,
  gapMs: 30 * 60 * 1000,

  // Title behavior
  userTouchedTitle: false,
};

/* ======================================================
   04) UTILS
   ====================================================== */

const fmt = (ts) => new Date(ts).toISOString().replace("T", " ").slice(0, 16);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function on(el, type, handler, options) {
  if (!el) return;
  el.addEventListener(type, handler, options);
}

function setText(el, txt = "") {
  if (el) el.textContent = txt ?? "";
}
function setValue(el, v = "") {
  if (el) el.value = v ?? "";
}
function clearEl(el) {
  if (el) el.innerHTML = "";
}
function setLog(v) {
  if (!els.log) return;
  els.log.textContent = typeof v === "string" ? v : JSON.stringify(v, null, 2);
}

function setBusy({ scanning = false, importing = false, deleting = false } = {}) {
  state.busy = { scanning: !!scanning, importing: !!importing, deleting: !!deleting };
  if (els.scanBtn) els.scanBtn.disabled = !!scanning;
  if (els.importBtn) els.importBtn.disabled = !!importing;
  if (els.deleteBtn) els.deleteBtn.disabled = !!deleting;
}

function uniqueSorted(arr) {
  return Array.from(new Set(arr.filter((x) => Number.isFinite(x) && x > 0))).sort((a, b) => a - b);
}

function normalizeAndSortItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((it) => ({ path: it?.path, ts: Number(it?.ts) }))
    .filter((it) => it.path && Number.isFinite(it.ts))
    .sort((a, b) => a.ts - b.ts);
}

function msToLabel(ms) {
  const s = ms / 1000;
  if (s < 60) return `${Math.round(s)}s`;
  const m = s / 60;
  if (m < 60) return `${Math.round(m)}min`;
  const h = m / 60;
  if (h < 48) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 14) return `${Math.round(d)}d`;
  const w = d / 7;
  if (w < 10) return `${Math.round(w)}w`;
  const mo = d / 30.4375;
  return `${Math.round(mo)}mo`;
}

/* ======================================================
   05) API
   ====================================================== */

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw data;
  return data;
}

/* ======================================================
   06) UI RENDERERS
   ====================================================== */

function uiSetCamera(connected, label = "") {
  setText(els.status, connected ? `Camera: ${label}` : "No camera connected");
  els.status?.classList.toggle("text-danger", !connected);

  if (els.cameraAlert) els.cameraAlert.classList.toggle("d-none", connected);

  if (els.scanBtn) els.scanBtn.disabled = !connected || state.busy.scanning;
  if (els.deleteBtn) els.deleteBtn.disabled = !connected || state.busy.deleting;

  if (!connected && els.progressBar) els.progressBar.value = 0;
}

function uiSetCameraCountdown(secondsRemaining) {
  if (!els.cameraPollCountdown) return;

  // Stable: 2,1,0 (no bouncing)
  const s = Math.max(0, Math.floor(secondsRemaining));
  if (els.cameraPollCountdown.textContent !== String(s)) {
    els.cameraPollCountdown.textContent = String(s);
  }
}

function renderCameraCountdown() {
  const msLeft = Math.max(0, state.cameraNextCheckAtMs - Date.now());
  uiSetCameraCountdown(msLeft / 1000);
}

function uiRenderTarget() {
  const effective = state.currentTargetRoot || state.defaultTargetRoot || "";
  setValue(els.currentDestRoot, effective);
  setText(els.currentDestInline, effective);

  const isOverride =
    !!state.currentTargetRoot &&
    !!state.defaultTargetRoot &&
    state.currentTargetRoot !== state.defaultTargetRoot;

  setText(els.destModeHint, isOverride ? "Export-Workflow aktiv" : "");
}

function uiRenderSessions(list) {
  if (!els.sessions) return;
  clearEl(els.sessions);

  list.forEach((s, i) => {
    els.sessions.add(
      new Option(
        `${String(i + 1).padStart(2, "0")} | ${fmt(s.start)} – ${fmt(s.end)} | ${s.count}`,
        String(i)
      )
    );
  });
}

function uiRenderSessionMeta(s) {
  if (!s) return;

  setText(els.metaStart, fmt(s.start));
  setText(els.metaEnd, fmt(s.end));
  setText(els.metaCount, String(s.count));
  setText(els.metaExample, s.exampleName);

  if (els.title && !state.userTouchedTitle) {
    els.title.value = `${fmt(s.start).slice(0, 10)} – ${s.count} files`;
  }
}

function uiSetCurrentImage(path) {
  state.currentFilePath = path || null;

  if (!path) {
    els.preview?.removeAttribute("src");
    setText(els.previewInfo, "");
    return;
  }

  els.preview.src = `/api/preview?path=${encodeURIComponent(path)}`;
  setText(els.previewInfo, path.split("/").pop());
}

function uiRenderPreview(session) {
  if (!session) return;

  uiSetCurrentImage(session.examplePath);
  clearEl(els.thumbStrip);

  for (let i = 0; i < session.items.length; i++) {
    const p = session.items[i];
    const img = document.createElement("img");
    img.src = `/api/preview?path=${encodeURIComponent(p)}`;
    img.className = `img-thumbnail${i === 0 ? " border-primary" : ""}`;
    img.style.height = "96px";
    img.style.cursor = "pointer";
    img.style.objectFit = "cover";
    img.onclick = () => uiSetCurrentImage(p);
    els.thumbStrip.appendChild(img);
  }
}

function uiApplyGapPresets(presetsMs, { keepNearest = true } = {}) {
  state.gapPresetsMs = Array.isArray(presetsMs) && presetsMs.length ? presetsMs : [30 * 60e3];
  if (!els.gapSlider) return;

  els.gapSlider.min = "0";
  els.gapSlider.max = String(Math.max(0, state.gapPresetsMs.length - 1));
  els.gapSlider.step = "1";

  let idx = 0;
  if (keepNearest) {
    idx = state.gapPresetsMs.findIndex((x) => x >= state.gapMs);
    if (idx < 0) idx = state.gapPresetsMs.length - 1;
  } else {
    idx = Math.floor(state.gapPresetsMs.length / 2);
  }

  state.gapPresetIndex = clamp(idx, 0, state.gapPresetsMs.length - 1);
  els.gapSlider.value = String(state.gapPresetIndex);

  gapSyncFromSlider();
}

/* ======================================================
   07) LOGIC (gap presets, grouping, selection)
   ====================================================== */

function gapSyncFromSlider() {
  if (!els.gapSlider || !state.gapPresetsMs.length) return;

  const idx = clamp(Number(els.gapSlider.value || 0), 0, state.gapPresetsMs.length - 1);
  state.gapPresetIndex = idx;
  state.gapMs = state.gapPresetsMs[idx];

  setText(els.gapValue, msToLabel(state.gapMs));

  if (els.gapLegend) {
    const first = msToLabel(state.gapPresetsMs[0]);
    const cur = msToLabel(state.gapMs);
    const last = msToLabel(state.gapPresetsMs[state.gapPresetsMs.length - 1]);
    els.gapLegend.textContent = `${first} — ${cur} — ${last} (${idx + 1}/${state.gapPresetsMs.length})`;
  }
}

function computeGapPresetsFromItems(
  items,
  { steps = APP.GAP_PRESET_STEPS, topK = APP.GAP_PRESET_TOP_K, minFloorMs = APP.GAP_MIN_FLOOR_MS } = {}
) {
  const ts = (items || [])
    .map((it) => it?.ts)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (ts.length < 2) return uniqueSorted([1000, 2000, 5000, 10_000, 30_000, 60_000]);

  const diffs = [];
  for (let i = 1; i < ts.length; i++) {
    const d = ts[i] - ts[i - 1];
    if (d > 0) diffs.push(d);
  }
  diffs.sort((a, b) => a - b);

  const span = ts[ts.length - 1] - ts[0];
  const minDiff = Math.max(minFloorMs, diffs[0] || minFloorMs);
  const maxDiff = diffs[diffs.length - 1] || minDiff;

  function snapUpToRealGap(target) {
    let lo = 0, hi = diffs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (diffs[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return diffs[lo] >= target ? diffs[lo] : diffs[diffs.length - 1];
  }

  const base = [minFloorMs, 2000, 5000, 10_000, 30_000, 60_000].filter((x) => x <= span);
  const largest = diffs.slice(-topK);

  const upper = Math.max(maxDiff, span);
  const logTargets = [];
  if (steps >= 2) {
    const a = Math.log(minDiff);
    const b = Math.log(upper);
    for (let i = 0; i < steps; i++) {
      const t = Math.exp(a + (b - a) * (i / (steps - 1)));
      logTargets.push(Math.max(minFloorMs, Math.min(upper, t)));
    }
  }

  const snapped = logTargets.map(snapUpToRealGap);

  const out = uniqueSorted(
    [...base, ...snapped, ...largest, maxDiff, span].map((x) => Math.max(minFloorMs, Math.min(span, x)))
  );

  if (out[out.length - 1] !== span) out.push(span);
  return uniqueSorted(out);
}

function groupSessionsClient(items, gapMs) {
  const groups = [];
  let cur = [];

  for (const it of items) {
    if (!cur.length || it.ts - cur[cur.length - 1].ts <= gapMs) cur.push(it);
    else {
      groups.push(cur);
      cur = [it];
    }
  }
  if (cur.length) groups.push(cur);

  return groups.map((arr, i) => ({
    id: String(i + 1),
    start: arr[0].ts,
    end: arr[arr.length - 1].ts,
    count: arr.length,
    examplePath: arr[0].path,
    exampleName: arr[0].path.split("/").pop(),
    items: arr.map((x) => x.path),
  }));
}

function getSelectedSession() {
  if (!els.sessions) return null;
  return state.sessions[els.sessions.selectedIndex] || null;
}

function restoreSelection({ preferSessionId = null, fallbackPath = null } = {}) {
  if (!els.sessions || !state.sessions.length) return;

  let idx = -1;
  if (preferSessionId != null) idx = state.sessions.findIndex((s) => String(s.id) === String(preferSessionId));
  if (idx < 0 && fallbackPath) idx = state.sessions.findIndex((s) => Array.isArray(s.items) && s.items.includes(fallbackPath));
  if (idx < 0) idx = clamp(els.sessions.selectedIndex, 0, state.sessions.length - 1);

  els.sessions.selectedIndex = idx;
}

/* ======================================================
   08) FLOWS (config, camera, scan, delete)
   ====================================================== */

async function loadConfig() {
  const cfg = await fetchJson("/api/config", { cache: "no-store" });
  state.defaultTargetRoot = cfg.targetRoot;
  state.currentTargetRoot = null;
  uiRenderTarget();
}

async function checkCameraOnce() {
  if (state.cameraCheckInFlight) return state.cameraLast?.label ?? null;
  state.cameraCheckInFlight = true;

  try {
    state.cameraLastCheckAtMs = Date.now();

    const data = await fetchJson("/api/camera", { cache: "no-store" });
    const connected = !!data.connected;
    const label = connected ? String(data.label || "") : "";

    // Statuswechsel-Logik für "Wartezeit"
    if (!connected) {
      // nur beim Übergang oder beim allerersten Mal starten
      if (!state.cameraWaitSinceMs) state.cameraWaitSinceMs = Date.now();
    } else {
      // sobald connected, Wartezeit zurücksetzen
      state.cameraWaitSinceMs = 0;
    }

    state.cameraLast = { connected, label };
    uiSetCamera(connected, label);
    return connected ? label : null;
  } catch {
    // Fehler behandeln wie "nicht verbunden"
    if (!state.cameraWaitSinceMs) state.cameraWaitSinceMs = Date.now();
    state.cameraLast = { connected: false, label: "" };
    uiSetCamera(false, "");
    return null;
  } finally {
    state.cameraCheckInFlight = false;
  }
}

function onSessionChange() {
  const s = getSelectedSession();
  uiRenderSessionMeta(s);
  uiRenderPreview(s);
}

function regroupSessionsAndRerender({ preserveSessionId = null, preservePath = null } = {}) {
  if (!state.scanItems.length) {
    clearEl(els.sessions);
    clearEl(els.thumbStrip);
    uiSetCurrentImage(null);
    return;
  }

  gapSyncFromSlider();

  state.sessions = groupSessionsClient(state.scanItems, state.gapMs);
  uiRenderSessions(state.sessions);

  restoreSelection({ preferSessionId: preserveSessionId, fallbackPath: preservePath });
  onSessionChange();
}

function applyScanItemsToUi({ preserveSessionId = null, preservePath = null } = {}) {
  const presets = computeGapPresetsFromItems(state.scanItems);
  uiApplyGapPresets(presets, { keepNearest: true });
  regroupSessionsAndRerender({ preserveSessionId, preservePath });
}

function resetScanUiAndState() {
  clearEl(els.sessions);
  clearEl(els.thumbStrip);

  els.preview?.removeAttribute("src");
  setText(els.previewInfo, "");
  setLog("");

  state.scanItems = [];
  state.sessions = [];
  state.currentFilePath = null;
  state.userTouchedTitle = false;

  els.progressBar?.removeAttribute("value");
}

async function runScan() {
  resetScanUiAndState();

  const camLabel = await checkCameraOnce();
  if (!camLabel) {
    setLog("Scan aborted: No camera detected. Check mount under /Volumes/<CameraName>.");
    return;
  }

  setBusy({ scanning: true });
  startProgressPolling();

  try {
    const data = await fetchJson("/api/scan", { method: "POST" });
    state.scanItems = normalizeAndSortItems(data.items);
    applyScanItemsToUi();
  } catch (e) {
    setLog(e);
  } finally {
    stopProgressPolling();
    setBusy({ scanning: false });
  }
}

async function deleteCurrentImage() {
  const s = getSelectedSession();
  if (!s) return setLog("Delete aborted: No session selected.");

  const preserveSessionId = s.id ?? null;
  const deletingPath = state.currentFilePath;
  if (!deletingPath) return setLog("Delete aborted: No image selected. Click a thumbnail first.");

  const name = deletingPath.split("/").pop();
  if (!confirm(`Delete (move to camera trash): ${name}?`)) return;

  setBusy({ deleting: true });

  try {
    const res = await fetch("/api/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: deletingPath }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setLog({ error: "Delete failed", status: res.status, data });

    state.scanItems = normalizeAndSortItems(state.scanItems.filter((it) => it.path !== deletingPath));
    applyScanItemsToUi({ preserveSessionId, preservePath: deletingPath });

    const s2 = getSelectedSession();
    if (s2?.items?.length) uiSetCurrentImage(s2.items[0]);
    else {
      uiSetCurrentImage(null);
      clearEl(els.thumbStrip);
    }

    setLog(`Deleted: ${name}\nMoved to: ${data.movedTo || "(unknown)"}`);
  } catch (err) {
    setLog({ error: "Delete exception", err: String(err) });
  } finally {
    setBusy({ deleting: false });
  }
}

/* ======================================================
   09) TIMERS / POLLING
   ====================================================== */

function startProgressPolling() {
  stopProgressPolling();

  state.progressTimer = setInterval(async () => {
    try {
      const p = await fetchJson("/api/scan/progress", { cache: "no-store" });

      if (!p || !p.total || p.total <= 0) {
        els.progressBar?.removeAttribute("value");
        return;
      }

      if (els.progressBar) els.progressBar.value = Math.round((p.current / p.total) * 100);
      if (p.active === false) stopProgressPolling();
    } catch {
      // ignore polling errors
    }
  }, APP.PROGRESS_POLL_MS);
}

function stopProgressPolling() {
  if (state.progressTimer) {
    clearInterval(state.progressTimer);
    state.progressTimer = null;
  }
}

function startCameraCountdownTicker() {
  stopCameraCountdownTicker();

  renderCameraCountdown();
  state.cameraCountdownTimer = setInterval(renderCameraCountdown, APP.CAMERA_COUNTDOWN_TICK_MS);
}

function stopCameraCountdownTicker() {
  if (state.cameraCountdownTimer) {
    clearInterval(state.cameraCountdownTimer);
    state.cameraCountdownTimer = null;
  }
}



function renderCameraElapsed() {
  if (!els.cameraPollCountdown) return;

  // wenn verbunden: optional 0 oder leer
  if (state.cameraLast?.connected) {
    els.cameraPollCountdown.textContent = "0";
    return;
  }

  if (!state.cameraWaitSinceMs) {
    els.cameraPollCountdown.textContent = "0";
    return;
  }

  const elapsedSec = Math.floor((Date.now() - state.cameraWaitSinceMs) / 1000);
  els.cameraPollCountdown.textContent = String(elapsedSec);
}

function startCameraPolling() {
  stopCameraPolling();

  checkCameraOnce();

  state.cameraPollTimer = setInterval(checkCameraOnce, APP.CAMERA_POLL_MS);
  state.cameraElapsedTimer = setInterval(renderCameraElapsed, 250);

  renderCameraElapsed();
}

function stopCameraPolling() {
  if (state.cameraPollTimer) {
    clearInterval(state.cameraPollTimer);
    state.cameraPollTimer = null;
  }
  if (state.cameraElapsedTimer) {
    clearInterval(state.cameraElapsedTimer);
    state.cameraElapsedTimer = null;
  }
}

/* ======================================================
   10) EVENT WIRING + BOOT
   ====================================================== */



on(els.scanBtn, "click", runScan);
on(els.deleteBtn, "click", deleteCurrentImage);
on(els.sessions, "change", onSessionChange);
on(els.gapSlider, "input", () => regroupSessionsAndRerender());
on(els.title, "input", () => { state.userTouchedTitle = true; });

// Boot: make slider draggable before first scan
uiApplyGapPresets(uniqueSorted(APP.FALLBACK_GAP_PRESETS_MS), { keepNearest: false });

// Boot: config + camera polling
loadConfig().catch(setLog);
startCameraPolling();

window.addEventListener("beforeunload", () => {
  stopCameraPolling();
  stopProgressPolling();
});