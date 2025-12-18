/**
 * studio-helper / public/app.js
 *
 * Frontend controller for Studio Helper.
 *
 * Responsibilities:
 * - Load server config (/api/config) and render target UI
 * - Check camera connection (/api/camera) and show status (red if missing)
 * - Scan filesystem (/api/scan) and receive raw items [{path, ts}]
 * - Compute gap presets from data and drive the gap slider
 * - Group raw items into sessions client-side (gap slider)
 * - Render session list, meta info, preview + thumbnails
 * - Poll scan progress and update progress bar
 */

console.log("[app.js] loaded", new Date().toISOString());

/* ======================================================
   DOM bindings
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
  retryCameraBtn: document.getElementById("retryCameraBtn"),

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
   State (single source of truth)
   ====================================================== */

const state = {
  // Raw scan output (sorted by ts ASC)
  scanItems: [], // [{ path, ts }]

  // Derived sessions (recomputed from scanItems)
  sessions: [],

  // Current image in preview
  currentFilePath: null,

  // Scan progress polling
  progressTimer: null,

  // Import target
  defaultTargetRoot: null,
  currentTargetRoot: null,

  // Gap slider (ONLY this model is used)
  gapPresetsMs: [],  // array of ms values
  gapPresetIndex: 0, // integer slider position
  gapMs: 30 * 60 * 1000,

  // Title behavior
  userTouchedTitle: false,
};

/* ======================================================
   Utilities
   ====================================================== */

const fmt = (ts) => new Date(ts).toISOString().replace("T", " ").slice(0, 16);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

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
  if (els.scanBtn) els.scanBtn.disabled = !!scanning;
  if (els.importBtn) els.importBtn.disabled = !!importing;
  if (els.deleteBtn) els.deleteBtn.disabled = !!deleting;
}
async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw data;
  return data;
}

/* ======================================================
   Camera
   ====================================================== */

function setCameraUI(connected, label = "") {
  setText(els.status, connected ? `Camera: ${label}` : "No camera connected");
  els.status?.classList.toggle("text-danger", !connected);

  if (els.cameraAlert) {
    els.cameraAlert.classList.toggle("d-none", connected);
  }

  if (els.scanBtn) els.scanBtn.disabled = !connected;
  if (els.deleteBtn) els.deleteBtn.disabled = !connected;

  if (!connected && els.progressBar) {
    els.progressBar.value = 0;
  }
}

async function checkCamera() {
  try {
    const data = await fetchJson("/api/camera", { cache: "no-store" });
    if (!data.connected) {
      setCameraUI(false);
      return null;
    }
    setCameraUI(true, data.label);
    return data.label;
  } catch {
    setCameraUI(false);
    return null;
  }
}

/* ======================================================
   Config + target (minimal; keep your existing behavior)
   ====================================================== */

async function loadConfig() {
  const cfg = await fetchJson("/api/config", { cache: "no-store" });
  state.defaultTargetRoot = cfg.targetRoot;
  state.currentTargetRoot = null;
  updateTargetUI();
}

function updateTargetUI() {
  const effective = state.currentTargetRoot || state.defaultTargetRoot || "";
  setValue(els.currentDestRoot, effective);
  setText(els.currentDestInline, effective);

  const isOverride =
    !!state.currentTargetRoot &&
    !!state.defaultTargetRoot &&
    state.currentTargetRoot !== state.defaultTargetRoot;

  setText(els.destModeHint, isOverride ? "Export-Workflow aktiv" : "");
}

/* ======================================================
   Gap slider (single implementation)
   ====================================================== */

/** Human label for ms durations (seconds → months-ish). */
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


function uniqueSorted(arr) {
  return Array.from(new Set(arr.filter((x) => Number.isFinite(x) && x > 0))).sort((a, b) => a - b);
}


/**
 * Build gap presets that are:
 * - data-driven (uses real consecutive gaps)
 * - complete (covers seconds -> maxSpan with log steps)
 * - practical (includes top largest gaps, includes maxDiff and maxSpan)
 *
 * Returns: sorted unique list of milliseconds.
 */
function computeGapPresetsFromItems(items, {
  steps = 11,      // number of log buckets (including ends, before snapping)
  topK = 6,        // include topK largest consecutive gaps explicitly
  minFloorMs = 1000,
} = {}) {
  const ts = (items || [])
    .map((it) => it?.ts)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (ts.length < 2) {
    return uniqueSorted([1000, 2000, 5000, 10_000, 30_000, 60_000]);
  }

  // consecutive gaps
  const diffs = [];
  for (let i = 1; i < ts.length; i++) {
    const d = ts[i] - ts[i - 1];
    if (d > 0) diffs.push(d);
  }
  diffs.sort((a, b) => a - b);

  const span = ts[ts.length - 1] - ts[0];
  const minDiff = Math.max(minFloorMs, diffs[0] || minFloorMs);
  const maxDiff = diffs[diffs.length - 1] || minDiff;

  // Helper: snap a target threshold to the smallest *actual* consecutive gap >= target
  function snapUpToRealGap(target) {
    // binary search lower bound
    let lo = 0, hi = diffs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (diffs[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return diffs[lo] >= target ? diffs[lo] : diffs[diffs.length - 1];
  }

  // 1) Always include some tiny floors (burst splitting)
  const base = [minFloorMs, 2000, 5000, 10_000, 30_000, 60_000].filter((x) => x <= span);

  // 2) Include topK largest consecutive gaps (these are the “natural breakpoints”)
  const largest = diffs.slice(-topK);

  // 3) Add log-spaced targets between minDiff and max(span, maxDiff)
  //    then snap each to a real consecutive gap.
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

  // 4) Ensure maxDiff is reachable (e.g. your “12h”)
  // 5) Ensure max span is reachable (mega session)
  const out = uniqueSorted([
    ...base,
    ...snapped,
    ...largest,
    maxDiff,
    span,
  ].map((x) => Math.max(minFloorMs, Math.min(span, x))));

  // Guarantee last is exactly span (mega-session)
  if (out[out.length - 1] !== span) out.push(span);

  return uniqueSorted(out);
}

/**
 * Apply presets to the slider element so it is draggable:
 * - sets min/max/value
 * - syncs state.gapMs and UI labels
 */
function applyGapPresetsToUI(presetsMs, { keepNearest = true } = {}) {
  state.gapPresetsMs = Array.isArray(presetsMs) && presetsMs.length ? presetsMs : [30 * 60e3];

  if (!els.gapSlider) return;

  els.gapSlider.min = "0";
  els.gapSlider.max = String(Math.max(0, state.gapPresetsMs.length - 1));
  els.gapSlider.step = "1";

  let idx = 0;

  if (keepNearest) {
    // choose first preset >= current gapMs, else last
    idx = state.gapPresetsMs.findIndex((x) => x >= state.gapMs);
    if (idx < 0) idx = state.gapPresetsMs.length - 1;
  } else {
    idx = Math.floor(state.gapPresetsMs.length / 2);
  }

  state.gapPresetIndex = clamp(idx, 0, state.gapPresetsMs.length - 1);
  els.gapSlider.value = String(state.gapPresetIndex);

  syncGapFromSlider();
}

/** Read slider position → update state.gapMs + UI label/legend. */
function syncGapFromSlider() {
  if (!els.gapSlider || !state.gapPresetsMs.length) return;

  const idx = clamp(Number(els.gapSlider.value || 0), 0, state.gapPresetsMs.length - 1);
  state.gapMs = state.gapPresetsMs[idx];

  setText(els.gapValue, msToLabel(state.gapMs));

  if (els.gapLegend) {
    const first = msToLabel(state.gapPresetsMs[0]);
    const cur = msToLabel(state.gapMs);
    const last = msToLabel(state.gapPresetsMs[state.gapPresetsMs.length - 1]);
    els.gapLegend.textContent = `${first} — ${cur} — ${last} (${idx + 1}/${state.gapPresetsMs.length})`;
  }
}

/* ======================================================
   Sessions: grouping + rendering
   ====================================================== */

function groupSessionsClient(items, gapMs) {
  const groups = [];
  let cur = [];

  for (const it of items) {
    if (!cur.length || it.ts - cur[cur.length - 1].ts <= gapMs) {
      cur.push(it);
    } else {
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

function renderSessions(list) {
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

function getSelectedSession() {
  if (!els.sessions) return null;
  return state.sessions[els.sessions.selectedIndex] || null;
}

function renderSessionMeta(s) {
  if (!s) return;

  setText(els.metaStart, fmt(s.start));
  setText(els.metaEnd, fmt(s.end));
  setText(els.metaCount, String(s.count));
  setText(els.metaExample, s.exampleName);

  if (els.title && !state.userTouchedTitle) {
    els.title.value = `${fmt(s.start).slice(0, 10)} – ${s.count} files`;
  }
}


function getSelectedSessionIndex() {
  return els.sessions ? els.sessions.selectedIndex : -1;
}

function restoreSelection({ preferSessionId = null, fallbackPath = null } = {}) {
  if (!els.sessions || !state.sessions.length) return;

  // 1) Try to restore by previous session id
  let idx = -1;
  if (preferSessionId != null) {
    idx = state.sessions.findIndex((s) => String(s.id) === String(preferSessionId));
  }

  // 2) Fallback: find session that contains a given image path
  if (idx < 0 && fallbackPath) {
    idx = state.sessions.findIndex((s) => Array.isArray(s.items) && s.items.includes(fallbackPath));
  }

  // 3) Fallback: clamp to last valid index
  if (idx < 0) idx = clamp(getSelectedSessionIndex(), 0, state.sessions.length - 1);

  els.sessions.selectedIndex = idx;
}

/* ======================================================
   Preview
   ====================================================== */

function setCurrentImage(path) {
  state.currentFilePath = path || null;

  if (!path) {
    els.preview?.removeAttribute("src");
    setText(els.previewInfo, "");
    return;
  }

  els.preview.src = `/api/preview?path=${encodeURIComponent(path)}`;
  setText(els.previewInfo, path.split("/").pop());
}

function showPreview(s) {
  if (!s) return;

  setCurrentImage(s.examplePath);
  clearEl(els.thumbStrip);

  for (let i = 0; i < s.items.length; i++) {
    const p = s.items[i];
    const img = document.createElement("img");
    img.src = `/api/preview?path=${encodeURIComponent(p)}`;
    img.className = `img-thumbnail${i === 0 ? " border-primary" : ""}`;
    img.style.height = "96px";
    img.style.cursor = "pointer";
    img.style.objectFit = "cover";
    img.onclick = () => setCurrentImage(p);
    els.thumbStrip.appendChild(img);
  }
}

function onSessionChange() {
  const s = getSelectedSession();
  renderSessionMeta(s);
  showPreview(s);
}


async function deleteCurrentImage() {
  const s = getSelectedSession();
  if (!s) {
    setLog("Delete aborted: No session selected.");
    return;
  }

  const preserveSessionId = s.id ?? null;
  const deletingPath = state.currentFilePath;

  if (!deletingPath) {
    setLog("Delete aborted: No image selected. Click a thumbnail first.");
    return;
  }

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
      return;
    }

    // 1) Update source-of-truth
    state.scanItems = state.scanItems.filter((it) => it.path !== deletingPath);

    // 2) (Optional) Recompute gap presets AFTER deletion
    //    Important: do NOT regroup without preservation afterwards.
    if (typeof computeGapPresetsFromItems === "function" && typeof initGapSliderFromPresets === "function") {
      const presets = computeGapPresetsFromItems(state.scanItems, { steps: 11, topK: 6 });
      // Keep slider position as close as possible to current gap.
      initGapSliderFromPresets(presets, { defaultStrategy: "nearest" });
    }

    // 3) Regroup + re-render ONCE, preserving session selection
    regroupSessionsAndRerender({
      preserveSessionId,
      preservePath: deletingPath, // fallback if ids shifted
    });

    // 4) Pick a sane next preview INSIDE the currently selected session
    const s2 = getSelectedSession();
    if (s2?.items?.length) {
      // If possible, keep same index as before; otherwise show first item.
      setCurrentImage(s2.items[0]);
    } else {
      setCurrentImage(null);
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
   Regroup + re-render on slider input
   ====================================================== */

function regroupSessionsAndRerender({ preserveSessionId = null, preservePath = null } = {}) {
  if (!state.scanItems.length) {
    clearEl(els.sessions);
    clearEl(els.thumbStrip);
    setCurrentImage(null);
    return;
  }

  syncGapFromSlider();

  state.sessions = groupSessionsClient(state.scanItems, state.gapMs);
  renderSessions(state.sessions);

  restoreSelection({ preferSessionId: preserveSessionId, fallbackPath: preservePath });

  onSessionChange();
}

/* ======================================================
   Scan progress polling
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

      if (els.progressBar) {
        const percent = Math.round((p.current / p.total) * 100);
        els.progressBar.value = percent;
      }

      if (p.active === false) stopProgressPolling();
    } catch {
      // ignore polling errors
    }
  }, 250);
}

function stopProgressPolling() {
  if (state.progressTimer) {
    clearInterval(state.progressTimer);
    state.progressTimer = null;
  }
}

/* ======================================================
   Scan
   ====================================================== */

async function runScan() {
  console.log("[runScan] click", new Date().toISOString());

  /* ------------------------------------------------------------
   * 1) Reset UI + in-memory state (do NOT touch gap presets yet)
   *    Presets must be computed from real scan results.
   * ------------------------------------------------------------ */
  clearEl(els.sessions);
  clearEl(els.thumbStrip);
  els.preview?.removeAttribute("src");
  setText(els.previewInfo, "");
  setLog("");

  state.scanItems = [];
  state.sessions = [];
  state.currentFilePath = null;
  state.userTouchedTitle = false;

  // Progress bar: indeterminate until progress endpoint has totals
  els.progressBar?.removeAttribute("value");

  /* ------------------------------------------------------------
   * 2) Guard: ensure camera is connected
   * ------------------------------------------------------------ */
  const camLabel = await checkCamera();
  if (!camLabel) {
    setLog("Scan aborted: No camera detected. Check mount under /Volumes/<CameraName>.");
    return;
  }

  /* ------------------------------------------------------------
   * 3) Start scan: lock UI + start progress polling
   * ------------------------------------------------------------ */
  setBusy({ scanning: true });
  startProgressPolling();

  try {
    /* ----------------------------------------------------------
     * 4) Execute scan request
     *    Backend returns: { items: [{path, ts}], ... }
     * ---------------------------------------------------------- */
    const data = await fetchJson("/api/scan", { method: "POST" });

    const items = Array.isArray(data.items) ? data.items : [];
    items.sort((a, b) => Number(a.ts ?? 0) - Number(b.ts ?? 0));
    state.scanItems = items;

    /* ----------------------------------------------------------
     * 5) Optional: debug gaps (now we have items)
     * ---------------------------------------------------------- */
    debugGaps(state.scanItems);

    /* ----------------------------------------------------------
     * 6) Build data-driven presets from the actual scan items
     *    and re-initialize the slider (now it becomes “usable”)
     * ---------------------------------------------------------- */
    const presets = computeGapPresetsFromItems(state.scanItems, { steps: 11, topK: 6 });
    initGapSliderFromPresets(presets, { defaultStrategy: "middle" });

    /* ----------------------------------------------------------
     * 7) Regroup sessions using the currently selected preset
     * ---------------------------------------------------------- */
    regroupSessionsAndRerender();
  } catch (e) {
    setLog(e);
  } finally {
    /* ----------------------------------------------------------
     * 8) Cleanup: stop progress + unlock UI
     * ---------------------------------------------------------- */
    stopProgressPolling();
    setBusy({ scanning: false });
  }
}

/* ==========================================================
   Helper: debug time gaps (safe to leave in during dev)
   ========================================================== */
function debugGaps(items) {
  const ts = (items || [])
    .map((x) => Number(x?.ts))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (ts.length < 2) {
    console.log("[debugGaps] not enough items");
    return;
  }

  const spanMs = ts[ts.length - 1] - ts[0];
  let maxDiff = 0;
  for (let i = 1; i < ts.length; i++) maxDiff = Math.max(maxDiff, ts[i] - ts[i - 1]);

  console.log("[debugGaps] first:", new Date(ts[0]).toISOString());
  console.log("[debugGaps] last :", new Date(ts[ts.length - 1]).toISOString());
  console.log("[debugGaps] spanMs:", spanMs, "spanHours:", (spanMs / 36e5).toFixed(2));
  console.log("[debugGaps] maxConsecutiveDiffMs:", maxDiff, "maxDiffHours:", (maxDiff / 36e5).toFixed(2));
}

/* ==========================================================
   Helper: initialize slider from presets
   - sets min/max/step/value
   - calls syncGapFromSlider() to set state.gapMs + labels
   ========================================================== */
function initGapSliderFromPresets(presetsMs, { defaultStrategy = "middle" } = {}) {
  state.gapPresetsMs = Array.isArray(presetsMs) ? presetsMs : [];

  if (!els.gapSlider || state.gapPresetsMs.length === 0) {
    // still keep a sane label if slider is missing
    syncGapFromSlider?.();
    return;
  }

  els.gapSlider.min = "0";
  els.gapSlider.max = String(Math.max(0, state.gapPresetsMs.length - 1));
  els.gapSlider.step = "1";

  let idx = 0;
  if (defaultStrategy === "middle") {
    idx = Math.floor((state.gapPresetsMs.length - 1) / 2);
  } else if (defaultStrategy === "nearest") {
    // choose the nearest preset to the current gapMs
    const g = Number(state.gapMs ?? 0);
    idx = state.gapPresetsMs.reduce((bestIdx, ms, i) => {
      const best = state.gapPresetsMs[bestIdx];
      return Math.abs(ms - g) < Math.abs(best - g) ? i : bestIdx;
    }, 0);
  }

  els.gapSlider.value = String(clamp(idx, 0, state.gapPresetsMs.length - 1));

  // single source of truth for state.gapMs + UI labels/legend
  syncGapFromSlider();
}

/* ======================================================
   Events + boot
   ====================================================== */

els.retryCameraBtn?.addEventListener("click", () => checkCamera());
els.scanBtn?.addEventListener("click", runScan);

els.sessions?.addEventListener("change", onSessionChange);

// IMPORTANT: use "input" so it updates while dragging
els.gapSlider?.addEventListener("input", () => {
  // If slider was stuck because max=0, applyGapPresetsToUI() fixes it.
  // Here we just regroup.
  regroupSessionsAndRerender();
});

els.title?.addEventListener("input", () => {
  state.userTouchedTitle = true;
});

els.deleteBtn?.addEventListener("click", deleteCurrentImage);

// Boot: make slider usable BEFORE first scan (so it is draggable)
applyGapPresetsToUI(
  uniqueSorted([5e3, 15e3, 30e3, 60e3, 5 * 60e3, 30 * 60e3, 2 * 60 * 60e3]),
  { keepNearest: false }
);

loadConfig().finally(checkCamera);