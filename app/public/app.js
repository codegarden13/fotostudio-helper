/**
 * studio-helper / public/app.js
 *
 * Frontend controller (structured, “modular within one file”).
 *
 * Responsibilities:
 * - Load server config (/api/config) and render target UI
 * - Poll camera connection (/api/camera) every 2s and show elapsed wait time when disconnected
 * - Scan filesystem (/api/scan) and receive raw items [{path, ts}]
 * - Compute gap presets from data and drive the gap slider
 * - Group raw items into sessions client-side (gap slider)
 * - Render session list, meta info, preview + thumbnails
 * - Fetch + show exposure (shutter/aperture/ISO) for the currently previewed file
 * - Delete current image and keep the current session selected
 * - Import selected session (POST /api/import with sessionStart+sessionEnd)
 * - Poll scan progress and update progress bar
 */

import { createLogger } from "./logger.js";

/* ======================================================
   01) CONFIG / CONSTANTS
====================================================== */

const APP = {
  PROGRESS_POLL_MS: 250,

  CAMERA_POLL_MS: 2000,
  CAMERA_ELAPSED_TICK_MS: 250,

  GAP_PRESET_STEPS: 11,
  GAP_PRESET_TOP_K: 6,
  GAP_MIN_FLOOR_MS: 1000,

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
  scanBtn: document.getElementById("scanBtn"),
  importBtn: document.getElementById("importBtn"),
  deleteBtn: document.getElementById("deleteBtn"),

  currentDestRoot: document.getElementById("currentDestRoot"),
  currentDestInline: document.getElementById("currentDestInline"),
  destModeHint: document.getElementById("destModeHint"),
  chooseDestBtn: document.getElementById("chooseDestBtn"),
  resetDestBtn: document.getElementById("resetDestBtn"),
 

  hdrSessionId: document.getElementById("hdrSessionId"),
  hdrCount: document.getElementById("hdrCount"),
  hdrRange: document.getElementById("hdrRange"),
  hdrGap: document.getElementById("hdrGap"),
  hdrDest: document.getElementById("hdrDest"),
  hdrSessionSelect: document.getElementById("hdrSessionSelect"),

  cameraAlert: document.getElementById("cameraAlert"),
  cameraPollCountdown: document.getElementById("cameraPollCountdown"),

  gapSlider: document.getElementById("gapSlider"),
  gapValue: document.getElementById("gapValue"),
  gapLegend: document.getElementById("gapLegend"),

  sessions: document.getElementById("sessions"),
  preview: document.getElementById("preview"),
  previewExposure: document.getElementById("previewExposure"),
  previewMeta: document.getElementById("previewMeta"),
  previewInfo: document.getElementById("previewInfo"),
  thumbStrip: document.getElementById("thumbStrip"),

  metaStart: document.getElementById("metaStart"),
  metaEnd: document.getElementById("metaEnd"),
  metaCount: document.getElementById("metaCount"),
  metaExample: document.getElementById("metaExample"),

  title: document.getElementById("title"),
  status: document.getElementById("status"),
  log: document.getElementById("log"),
  progressBar: document.getElementById("progressBar"),
};

/* ======================================================
   03) LOGGER
====================================================== */

const logger = createLogger({ el: els.log, mirrorToServer: true });
const logLine = logger.logLine;
const setLog = logger.setLog?.bind(logger) || ((v) => logLine("[log]", v));

/* ======================================================
   04) STATE
====================================================== */

const state = {
  scanItems: [],
  sessions: [],
  currentFilePath: null,

  busy: { scanning: false, importing: false, deleting: false },

  progressTimer: null,
  cameraPollTimer: null,
  cameraElapsedTimer: null,
  cameraCheckInFlight: false,
  cameraLast: { connected: false, label: "" },
  cameraWaitSinceMs: 0,

  defaultTargetRoot: null,
  currentTargetRoot: null,
  targetStatus: { exists: false, writable: false, path: "" },

  gapPresetsMs: [],
  gapPresetIndex: 0,
  gapMs: 30 * 60 * 1000,

  userTouchedTitle: false,


};

/* ======================================================
   05) UTILS
====================================================== */

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const fmt = (ts) => new Date(ts).toISOString().replace("T", " ").slice(0, 16);

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

function fmtRange(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "–";
  const a = fmt(start);
  const b = fmt(end);
  const dayA = a.slice(0, 10);
  const dayB = b.slice(0, 10);
  if (dayA === dayB) return `${dayA} ${a.slice(11)}–${b.slice(11)}`;
  return `${a}–${b}`;
}

/* ======================================================
   06) API
====================================================== */

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw data;
  return data;
}

/* ======================================================
   07) UI: CAMERA + HEADER
====================================================== */

function uiSetCamera(connected, label = "") {
  setText(els.status, connected ? `Camera: ${label}` : "No camera connected");
  els.status?.classList.toggle("text-danger", !connected);
  els.cameraAlert?.classList.toggle("d-none", connected);

  // Camera-gated actions
  if (els.scanBtn) els.scanBtn.disabled = !connected || !!state.busy.scanning;
  if (els.deleteBtn) els.deleteBtn.disabled = !connected || !!state.busy.deleting;

  // Keep UI consistent when camera disappears
  if (!connected && els.progressBar) els.progressBar.value = 0;

  // Import requires: camera + session selected + target known + not busy
  uiUpdateImportEnabled();
  uiRenderImportButton();
}

function uiSetCameraElapsed(secondsElapsed) {
  if (!els.cameraPollCountdown) return;
  const seconds = Math.max(0, Math.floor(secondsElapsed));
  const text = String(seconds);
  if (els.cameraPollCountdown.textContent !== text) {
    els.cameraPollCountdown.textContent = text;
  }
}

function renderCameraElapsed() {
  if (state.cameraLast?.connected) return uiSetCameraElapsed(0);
  if (!state.cameraWaitSinceMs) return uiSetCameraElapsed(0);
  uiSetCameraElapsed((Date.now() - state.cameraWaitSinceMs) / 1000);
}

function uiRenderHeaderMeta(session = null) {
  setText(els.hdrSessionId, session ? String(session.id ?? "–") : "–");
  setText(els.hdrCount, session ? String(session.count ?? "–") : "–");
  setText(els.hdrRange, session ? fmtRange(session.start, session.end) : "–");
  setText(els.hdrGap, state.gapMs ? msToLabel(state.gapMs) : "–");

  const effective = getEffectiveTargetRoot();
  setText(els.hdrDest, effective || "–");

  if (els.hdrSessionSelect && els.sessions) {
    const idx = els.sessions.selectedIndex;
    setText(els.hdrSessionSelect, idx >= 0 ? String(idx + 1).padStart(2, "0") : "–");
  }
}

/* ======================================================
   08) UI: TARGET + IMPORT BUTTON
====================================================== */

function getEffectiveTargetRoot() {
  return state.currentTargetRoot || state.defaultTargetRoot || "";
}

function uiRenderTarget() {
  const effective = getEffectiveTargetRoot();
  setValue(els.currentDestRoot, effective);
  setText(els.currentDestInline, effective);

  const isOverride =
    !!state.currentTargetRoot &&
    !!state.defaultTargetRoot &&
    state.currentTargetRoot !== state.defaultTargetRoot;

  // Keep hint space for target status messages; do not override if you use it elsewhere
  setText(els.destModeHint, isOverride ? "Export-Workflow aktiv" : "");

  uiRenderHeaderMeta(getSelectedSession());
  uiRenderImportButton();
  uiUpdateImportEnabled();
}

function uiRenderImportButton() {
  if (!els.importBtn) return;

  const root = getEffectiveTargetRoot();
  if (!root) {
    els.importBtn.textContent = "Importieren";
    return;
  }

  // Use a compact label (volume name / last segment)
  const short = root.split("/").filter(Boolean).slice(-1)[0] || root;
  els.importBtn.textContent = `Nach ${short} importieren`;
}


function hasSelectedSession() {
  if (!els.sessions) return false;
  const idx = els.sessions.selectedIndex;
  return idx >= 0 && !!state.sessions?.[idx];
}

function uiUpdateImportEnabled() {
  if (!els.importBtn) return;

  const ok =
    !!state.cameraLast?.connected &&
    !!getEffectiveTargetRoot() &&
    hasSelectedSession() &&
    !state.busy.importing;

  els.importBtn.disabled = !ok;
}

function setBusy({ scanning = false, importing = false, deleting = false } = {}) {
  state.busy = { scanning: !!scanning, importing: !!importing, deleting: !!deleting };

  // Base busy gating (camera gating is handled in uiSetCamera)
  if (els.scanBtn) els.scanBtn.disabled = !!scanning || !state.cameraLast?.connected;
  if (els.deleteBtn) els.deleteBtn.disabled = !!deleting || !state.cameraLast?.connected;

  uiUpdateImportEnabled();
  uiRenderImportButton();
}

/* ======================================================
   09) UI: SESSIONS + META
====================================================== */

function uiRenderSessions(list) {
  if (!els.sessions) return;
  clearEl(els.sessions);

  list.forEach((s, i) => {
    const label = `${String(i + 1).padStart(2, "0")} | ${fmtRange(s.start, s.end)} | ${s.count}`;
    els.sessions.add(new Option(label, String(i)));
  });

  uiRenderHeaderMeta(getSelectedSession());
}

function uiRenderSessionMeta(s) {
  if (!s) {
    setText(els.metaStart, "–");
    setText(els.metaEnd, "–");
    setText(els.metaCount, "–");
    setText(els.metaExample, "–");
    uiRenderHeaderMeta(null);
    return;
  }

  setText(els.metaStart, fmt(s.start));
  setText(els.metaEnd, fmt(s.end));
  setText(els.metaCount, String(s.count));
  setText(els.metaExample, s.exampleName);

  if (els.title && !state.userTouchedTitle) {
    els.title.value = `${fmt(s.start).slice(0, 10)} – ${s.count} files`;
  }

  uiRenderHeaderMeta(s);
}

/* ======================================================
   10) UI: EXPOSURE + PREVIEW
====================================================== */

function formatExposureParts({ shutter, aperture, iso } = {}) {
  const parts = [];
  if (shutter) parts.push(`⏱ ${shutter}`);
  if (aperture) parts.push(`ƒ/${aperture}`);
  if (iso) parts.push(`ISO ${iso}`);
  return parts;
}

function uiSetExposureNone() {
  if (els.previewExposure) els.previewExposure.textContent = "";
}

function uiSetExposureLoading() {
  if (els.previewExposure) els.previewExposure.textContent = "⏱ …   ƒ/…   ISO …";
}

function uiSetExposureError() {
  if (els.previewExposure) els.previewExposure.textContent = "⏱ –   ƒ/–   ISO –";
}

function uiSetExposureText(exp) {
  if (!els.previewExposure) return;
  const parts = formatExposureParts(exp);
  els.previewExposure.textContent = parts.length ? parts.join("   ") : "";
}

function uiRenderPreview(session) {
  if (!session) {
    clearEl(els.thumbStrip);
    uiSetCurrentImage(null);
    return;
  }

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

    img.onclick = () => {
      logLine("[thumb] click", p);
      uiSetCurrentImage(p);
    };

    els.thumbStrip?.appendChild(img);
  }
}

async function uiSetCurrentImage(path) {
  state.currentFilePath = path || null;

  if (!path) {
    els.preview?.removeAttribute("src");
    setText(els.previewInfo, "");
    setText(els.previewMeta, "–");
    uiSetExposureNone();
    return;
  }

  els.preview.src = `/api/preview?path=${encodeURIComponent(path)}`;
  const name = path.split("/").pop();
  setText(els.previewInfo, name);
  setText(els.previewMeta, name);

  uiSetExposureLoading();

  try {
    const exp = await fetchExposure(path);
    logLine("[exposure] ok", exp);
    uiSetExposureText(exp);
  } catch (e) {
    logLine("[exposure] failed", e);
    uiSetExposureError();
  }
}

async function fetchExposure(filePath) {
  const url = `/api/exposure?path=${encodeURIComponent(filePath)}`;
  logLine("[exposure] GET", url);
  return fetchJson(url, { cache: "no-store" });
}

/* ======================================================
   11) GAP PRESETS + GROUPING
====================================================== */

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

  uiRenderHeaderMeta(getSelectedSession());
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

function ensureSelection({ preferSessionId = null, fallbackPath = null } = {}) {
  if (!els.sessions || !state.sessions.length) return;

  let idx = -1;

  if (preferSessionId != null) {
    idx = state.sessions.findIndex((s) => String(s.id) === String(preferSessionId));
  }

  if (idx < 0 && fallbackPath) {
    idx = state.sessions.findIndex((s) => Array.isArray(s.items) && s.items.includes(fallbackPath));
  }

  if (idx < 0) idx = 0;
  idx = clamp(idx, 0, state.sessions.length - 1);

  els.sessions.selectedIndex = idx;
}

/* ======================================================
   12) FLOWS (config, camera, scan, import, delete)
====================================================== */

async function loadConfig() {
  const cfg = await fetchJson("/api/config", { cache: "no-store" });
  state.defaultTargetRoot = cfg.targetRoot || "";
  state.currentTargetRoot = null;
  uiRenderTarget();
  logLine("[config] loaded", cfg);
}

async function checkCameraOnce() {
  if (state.cameraCheckInFlight) return state.cameraLast?.label ?? null;
  state.cameraCheckInFlight = true;

  try {
    const data = await fetchJson("/api/camera", { cache: "no-store" });
    const connected = !!data.connected;
    const label = connected ? String(data.label || "") : "";

    if (!connected) {
      if (!state.cameraWaitSinceMs) state.cameraWaitSinceMs = Date.now();
    } else {
      state.cameraWaitSinceMs = 0;
    }

    state.cameraLast = { connected, label };
    uiSetCamera(connected, label);

    return connected ? label : null;
  } catch (e) {
    if (!state.cameraWaitSinceMs) state.cameraWaitSinceMs = Date.now();
    state.cameraLast = { connected: false, label: "" };
    uiSetCamera(false, "");
    logLine("[camera] error", e);
    return null;
  } finally {
    state.cameraCheckInFlight = false;
  }
}

function onSessionChange() {
  const s = getSelectedSession();
  uiRenderSessionMeta(s);
  uiRenderPreview(s);
  uiRenderHeaderMeta(s);
  uiUpdateImportEnabled();
}

function regroupSessionsAndRerender({ preserveSessionId = null, preservePath = null } = {}) {
  if (!state.scanItems.length) {
    clearEl(els.sessions);
    clearEl(els.thumbStrip);
    uiSetCurrentImage(null);
    uiRenderSessionMeta(null);
    uiRenderHeaderMeta(null);
    uiUpdateImportEnabled();
    return;
  }

  gapSyncFromSlider();
  state.sessions = groupSessionsClient(state.scanItems, state.gapMs);

  uiRenderSessions(state.sessions);
  ensureSelection({ preferSessionId: preserveSessionId, fallbackPath: preservePath });
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
  setText(els.previewMeta, "–");
  uiSetExposureNone();

  setLog(""); /* mirrors the entire current UI text to the server */

  state.scanItems = [];
  state.sessions = [];
  state.currentFilePath = null;
  state.userTouchedTitle = false;

  els.progressBar?.removeAttribute("value");
  uiRenderHeaderMeta(null);
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
    logLine("[scan] ok", { items: state.scanItems.length });
  } catch (e) {
    setLog(e);
    logLine("[scan] failed", e);
  } finally {
    stopProgressPolling();
    setBusy({ scanning: false });
    uiSetCamera(state.cameraLast.connected, state.cameraLast.label);
  }
}

async function importSelectedSession() {
  // Hard guard: camera must be connected *now*
  const camLabel = await checkCameraOnce();
  if (!camLabel) {
    setLog("Import aborted: No camera detected. Connect camera (MSC / Mass Storage) and wait for mount.");
    return;
  }

  const s = getSelectedSession();
  if (!s) return setLog("Import aborted: No session selected.");
  if (!Array.isArray(s.items) || s.items.length === 0) return setLog("Import aborted: Session has no items.");

  const root = getEffectiveTargetRoot();
  if (!root) return setLog("Import aborted: No target root configured.");

  const sessionTitle = (els.title?.value || "").trim();
  const payload = {
    sessionTitle,
    sessionStart: s.start,
    sessionEnd: s.end,
    files: s.items,
  };

  setBusy({ importing: true });
  logLine("[import] POST /api/import", { title: sessionTitle, count: s.count });

  try {
    const out = await fetchJson("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const importedSet = new Set(s.items);
    state.scanItems = normalizeAndSortItems(state.scanItems.filter((it) => !importedSet.has(it.path)));

    applyScanItemsToUi();

    setLog(
      `Import OK\n` +
      `targetRoot: ${out.targetRoot || root}\n` +
      `sessionDir: ${out.sessionDir || "(unknown)"}\n` +
      `logFile: ${out.logFile || "(unknown)"}\n` +
      `copied: ${out.copied ?? "?"}, skipped: ${out.skipped ?? "?"}`
    );

    logLine("[import] ok", out);
  } catch (e) {
    setLog({ error: "Import failed", details: e });
    logLine("[import] failed", e);
  } finally {
    setBusy({ importing: false });
    uiSetCamera(state.cameraLast.connected, state.cameraLast.label);
    uiRenderHeaderMeta(getSelectedSession());
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
    if (!res.ok) {
      setLog({ error: "Delete failed", status: res.status, data });
      logLine("[delete] failed", { status: res.status, data });
      return;
    }

    state.scanItems = normalizeAndSortItems(state.scanItems.filter((it) => it.path !== deletingPath));
    applyScanItemsToUi({ preserveSessionId, preservePath: deletingPath });

    const s2 = getSelectedSession();
    if (s2?.items?.length) uiSetCurrentImage(s2.items[0]);
    else {
      uiSetCurrentImage(null);
      clearEl(els.thumbStrip);
    }

    setLog(`Deleted: ${name}\nMoved to: ${data.movedTo || "(unknown)"}`);
    logLine("[delete] ok", data);
  } catch (err) {
    setLog({ error: "Delete exception", err: String(err) });
    logLine("[delete] exception", err);
  } finally {
    setBusy({ deleting: false });
    uiSetCamera(state.cameraLast.connected, state.cameraLast.label);
    uiRenderHeaderMeta(getSelectedSession());
  }
}

/* ======================================================
   13) TIMERS / POLLING
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
      // ignore
    }
  }, APP.PROGRESS_POLL_MS);
}

function stopProgressPolling() {
  if (state.progressTimer) {
    clearInterval(state.progressTimer);
    state.progressTimer = null;
  }
}

function startCameraPolling() {
  stopCameraPolling();
  checkCameraOnce();
  state.cameraPollTimer = setInterval(checkCameraOnce, APP.CAMERA_POLL_MS);
  state.cameraElapsedTimer = setInterval(renderCameraElapsed, APP.CAMERA_ELAPSED_TICK_MS);
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
   14) EVENT WIRING + BOOT
====================================================== */

on(els.scanBtn, "click", runScan);
on(els.importBtn, "click", importSelectedSession);
on(els.deleteBtn, "click", deleteCurrentImage);

on(els.sessions, "change", onSessionChange);
on(els.gapSlider, "input", () => regroupSessionsAndRerender());

on(els.title, "input", () => {
  state.userTouchedTitle = true;
});

on(els.mountTargetBtn, "click", async () => {
  try {
    logLine("[target] mount helper click");
    const r = await fetchJson("/api/target/open", { method: "POST" });
    logLine("[target] open ok", r);
  } catch (e) {
    logLine("[target] open failed", e);
    setLog(e);
  }
});

// Boot: make slider usable before first scan
uiApplyGapPresets(uniqueSorted(APP.FALLBACK_GAP_PRESETS_MS), { keepNearest: false });

// Boot: config + camera polling
loadConfig().catch((e) => {
  setLog(e);
  logLine("[config] load failed", e);
});

startCameraPolling();

window.addEventListener("beforeunload", () => {
  stopCameraPolling();
  stopProgressPolling();
  logger.flush?.(); // best-effort
});