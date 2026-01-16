/**
 * studio-helper / public/app.js
 *
 * Frontend controller (single-page app).
 *
 * Notes 
 * - Scan works from a selected source folder.
 * - Source selection Bootstrap-based and is the only supported picker.
 * 
 */

import { createLogger } from "./logger.js";

// Stateless functions from util
import {
  clamp,
  fmt,
  uniqueSorted,
  normalizeAndSortItems,
  msToLabel,
  fmtRange,
  formatExposureParts,
  computeGapPresetsFromItems,
  groupSessionsClient,
} from "./lib/util.js";

import {
  apiGetConfig,
  apiBrowseFs,
  apiScan,
  apiScanProgress,
  apiExposure,
  apiImport,
  apiDeleteFile,
  apiDeleteSession,
} from "./lib/api.js";
/* ======================================================
   01) CONFIG / CONSTANTS
====================================================== */

const APP = {
  PROGRESS_POLL_MS: 250,
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

  importBtn: document.getElementById("importBtn"),
  deleteBtn: document.getElementById("deleteBtn"),
  selSrcBtn: document.getElementById("selSrcBtn"),

  // Source picker modal
  sourcePickerModal: document.getElementById("sourcePickerModal"),
  srcPickerPath: document.getElementById("srcPickerPath"),
  srcPickerUpBtn: document.getElementById("srcPickerUpBtn"),
  srcPickerList: document.getElementById("srcPickerList"),
  srcPickerSelectBtn: document.getElementById("srcPickerSelectBtn"),

  srcModeHint: document.getElementById("srcModeHint"),



  // Target
  currentDestRoot: document.getElementById("currentDestRoot"),
  currentDestInline: document.getElementById("currentDestInline"),
  destModeHint: document.getElementById("destModeHint"),
  chooseDestBtn: document.getElementById("chooseDestBtn"),


  // Header
  hdrSessionId: document.getElementById("hdrSessionId"),
  hdrCount: document.getElementById("hdrCount"),
  hdrRange: document.getElementById("hdrRange"),
  hdrGap: document.getElementById("hdrGap"),
  hdrDest: document.getElementById("hdrDest"),
  hdrSessionSelect: document.getElementById("hdrSessionSelect"),

  // Gap slider
  gapSlider: document.getElementById("gapSlider"),
  gapValue: document.getElementById("gapValue"),
  gapLegend: document.getElementById("gapLegend"),

  // Sessions + preview
  sessions: document.getElementById("sessions"),
  preview: document.getElementById("preview"),
  previewExposure: document.getElementById("previewExposure"),
  previewMeta: document.getElementById("previewMeta"),
  previewInfo: document.getElementById("previewInfo"),
  thumbStrip: document.getElementById("thumbStrip"),

  // Session meta (left card)
  metaStart: document.getElementById("metaStart"),
  metaEnd: document.getElementById("metaEnd"),
  metaCount: document.getElementById("metaCount"),
  metaExample: document.getElementById("metaExample"),

  delSessionBtn: document.getElementById("delSessionBtn"),




  // Import fields
  title: document.getElementById("title"),
  sessionNote: document.getElementById("sessionNote"),
  sessionKeywords: document.getElementById("sessionKeywords"),

  // Log + progress
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
  defaultTargetRoot: null,
  currentTargetRoot: null,
  gapPresetsMs: [],
  gapPresetIndex: 0,
  gapMs: 30 * 60 * 1000,
  userTouchedTitle: false,

  // Source folder (selected via modal)
  sourceRoot: "/",
  _srcPicker: null,
};

function defaultMacStartPath() {
  // Browser JS can’t expand "~" by itself; let the server resolve it.
  // We pass a token the server understands (recommended), or we just start at "/Volumes".
  return "USER_HOME_PICTURES";
}

function uiRenderHeader() {
  uiRenderHeaderMeta(getSelectedSession());
}

/* ======================================================
   05) DOM UTILS (candidate for public/lib/dom.js)
====================================================== */

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



/* ======================================================
   07) STATE MUTATORS
====================================================== */




function setSourceRoot(p) {
  const v = String(p || "").trim();
  state.sourceRoot = v || "/";              // keep stable fallback
  setText(els.srcModeHint, state.sourceRoot);
  setLog(`Source folder set to:\n${state.sourceRoot}`);
  logLine("[sourceRoot] set", state.sourceRoot);
}

//#TODO:Was ist der unterschied der beiden Log varianten oben



/* ======================================================
   08) UI: HEADER + TARGET + BUTTONS
====================================================== */

function getEffectiveTargetRoot() {
  return state.currentTargetRoot || state.defaultTargetRoot || "";
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
    setText(
      els.hdrSessionSelect,
      idx >= 0 ? String(idx + 1).padStart(2, "0") : "–"
    );
  }
}

function uiRenderTarget() {
  const effective = getEffectiveTargetRoot();
  setValue(els.currentDestRoot, effective);
  setText(els.currentDestInline, effective);

  const isOverride =
    !!state.currentTargetRoot &&
    !!state.defaultTargetRoot &&
    state.currentTargetRoot !== state.defaultTargetRoot;

  setText(els.destModeHint, isOverride ? "Export-Workflow aktiv" : "");

  uiRenderHeader();

  uiUpdateImportEnabled();
}

/*
function uiRenderImportButton() {
  if (!els.importBtn) return;

  const root = getEffectiveTargetRoot();
  if (!root) {
    els.importBtn.textContent = "Importieren";
    return;
  }

  const short = root.split("/").filter(Boolean).slice(-1)[0] || root;
  els.importBtn.textContent = `Nach ${short} importieren`;
}

*/

function hasSelectedSession() {
  if (!els.sessions) return false;
  const idx = els.sessions.selectedIndex;
  return idx >= 0 && !!state.sessions?.[idx];
}

function uiUpdateImportEnabled() {
  if (!els.importBtn) return;

  const ok =
    !!getEffectiveTargetRoot() &&
    hasSelectedSession() &&
    !state.busy.importing;

  els.importBtn.disabled = !ok;
}

function setBusy({ scanning = false, importing = false, deleting = false } = {}) {
  state.busy = {
    scanning: !!scanning,
    importing: !!importing,
    deleting: !!deleting,
  };

  if (els.scanBtn) els.scanBtn.disabled = !!scanning;
  if (els.deleteBtn) els.deleteBtn.disabled = !!deleting;

  uiUpdateImportEnabled();
  //uiRenderImportButton();
}

/* ======================================================
   09) UI: SESSIONS + META
====================================================== */

function uiRenderSessions(list) {
  if (!els.sessions) return;
  clearEl(els.sessions);

  list.forEach((s, i) => {
    const label = `${String(i + 1).padStart(2, "0")} | ${fmtRange(
      s.start,
      s.end
    )} | ${s.count}`;
    els.sessions.add(new Option(label, String(i)));
  });

  uiRenderHeader();
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



/* ======================================================
   11) GAP PRESETS + GROUPING
====================================================== */

function uiApplyGapPresets(presetsMs, { keepNearest = true } = {}) {
  // Always ensure we have >= 2 presets, otherwise the slider becomes non-movable.
  let p = uniqueSorted(Array.isArray(presetsMs) ? presetsMs : []);
  if (p.length < 2) p = uniqueSorted(APP.FALLBACK_GAP_PRESETS_MS);

  state.gapPresetsMs = p;

  if (!els.gapSlider) return;

  els.gapSlider.min = "0";
  els.gapSlider.max = String(Math.max(1, state.gapPresetsMs.length - 1)); // ✅ never 0
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

  const idx = clamp(
    Number(els.gapSlider.value || 0),
    0,
    state.gapPresetsMs.length - 1
  );
  state.gapPresetIndex = idx;
  state.gapMs = state.gapPresetsMs[idx];

  setText(els.gapValue, msToLabel(state.gapMs));

  if (els.gapLegend) {
    const first = msToLabel(state.gapPresetsMs[0]);
    const cur = msToLabel(state.gapMs);
    const last = msToLabel(state.gapPresetsMs[state.gapPresetsMs.length - 1]);
    els.gapLegend.textContent = `${first} — ${cur} — ${last} (${idx + 1}/${state.gapPresetsMs.length})`;
  }

  uiRenderHeader();
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
    idx = state.sessions.findIndex(
      (s) => Array.isArray(s.items) && s.items.includes(fallbackPath)
    );
  }

  if (idx < 0) idx = 0;
  idx = clamp(idx, 0, state.sessions.length - 1);

  els.sessions.selectedIndex = idx;
}

/* ======================================================
   12) FLOWS (config, scan, import, delete)
====================================================== */



async function loadConfig() {
  const cfg = await apiGetConfig({ logLine });
  state.defaultTargetRoot = cfg.targetRoot || "";
  state.currentTargetRoot = null;
  uiRenderTarget();
  logLine("[config] loaded", cfg);
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

  setLog("");

  state.scanItems = [];
  state.sessions = [];
  state.currentFilePath = null;
  state.userTouchedTitle = false;

  els.progressBar?.removeAttribute("value");
  uiRenderHeaderMeta(null);
}

async function runScan() {
  resetScanUiAndState();

  if (!state.sourceRoot) {
    setLog("Scan aborted: No source folder selected. Click “Quelle wählen” first.");
    return;
  }

  setBusy({ scanning: true });
  startProgressPolling();

  try {
    const data = await apiScan(state.sourceRoot, { logLine });

    state.scanItems = normalizeAndSortItems(data.items);
    applyScanItemsToUi();

    logLine("[scan] ok", { items: state.scanItems.length, sourceRoot: state.sourceRoot });
  } catch (e) {
    setLog(e);
    logLine("[scan] failed", e);
  } finally {
    stopProgressPolling();
    setBusy({ scanning: false });
    uiRenderHeader();
  }
}

/**
 * Import the currently selected session into the configured targetRoot and
 * (optionally/required) delete the source session afterwards.
 *
 * Client responsibilities:
 * - Validate selection + sourceRoot + target root availability
 * - Build the server payload
 * - Call import API
 * - After successful import: delete source session (POST /api/delete-session)
 * - On success: remove imported originals from scanItems, then re-group + re-render
 * - Keep UI responsive and logging consistent
 *
 * Server contracts:
 *   POST /api/import
 *   Body: { sessionTitle, sourceRoot, sessionNote, sessionKeywords, sessionStart, sessionEnd, files }
 *
 *   POST /api/delete-session
 *   Body: { sourceRoot, files }
 */
async function importSelectedSession() {
  // 1) Guards: need a selected session with items
  const s = getSelectedSession();
  if (!s) return setLog("Import aborted: No session selected.");

  const files = Array.isArray(s.items) ? s.items.slice() : [];
  if (!files.length) return setLog("Import aborted: Session has no items.");

  // 2) Guard: importing requires a configured target root
  const targetRoot = getEffectiveTargetRoot();
  if (!targetRoot) return setLog("Import aborted: No target root configured.");

  // 3) Guard: server-side safety boundary for delete step requires sourceRoot
  const sourceRoot = String(state.sourceRoot || "").trim();
  if (!sourceRoot) {
    return setLog("Import aborted: sourceRoot missing. Select a source folder first.");
  }

  // 4) Read user inputs (server sanitizes where needed)
  const sessionTitle = String(els.title?.value ?? "").trim();
  const sessionNote = String(els.sessionNote?.value ?? "").trim();
  const sessionKeywords = String(els.sessionKeywords?.value ?? "").trim();

  // 5) Payload: stable contract to server
  const payload = {
    sessionTitle,
    sourceRoot,
    sessionNote,
    sessionKeywords,
    sessionStart: s.start,
    sessionEnd: s.end,
    files,
  };

  // Preserve UI context before any mutations (regrouping can reindex sessions)
  const preserveSessionId = s.id ?? null;
  const preservePath = state.currentFilePath ?? null;

  // 6) Lock UI actions while import + delete-after-export are in-flight
  setBusy({ importing: true });

  logLine("[import] POST /api/import", {
    title: sessionTitle || "(Untitled)",
    noteLen: sessionNote.length,
    keywords: sessionKeywords
      ? sessionKeywords.split(",").map((x) => x.trim()).filter(Boolean).length
      : 0,
    count: s.count ?? files.length,
  });

  try {
    // 7) Import
    const out = await apiImport(payload, { logLine });
    logLine("[import] ok", out);

    // 8) Delete-after-export (required by your workflow)
    //
    // IMPORTANT: do this before mutating scanItems so the UI reflects reality on disk.
    logLine("[delete-after-export] POST /api/delete-session", {
      sourceRoot,
      files: files.length,
    });

    const delRes = await fetch("/api/delete-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceRoot, files }),
    });

    const delData = await delRes.json().catch(() => ({}));
    if (!delRes.ok) {
      setLog({
        error: "Import OK, but delete-after-export failed",
        import: {
          sessionDir: out.sessionDir,
          copied: out.copied,
          skipped: out.skipped,
        },
        delete: { status: delRes.status, data: delData },
      });
      logLine("[delete-after-export] failed", { status: delRes.status, data: delData });
      return;
    }

    logLine("[delete-after-export] ok", delData);

    // 9) Now that disk is updated, update UI state:
    // scanItems contains ONLY originals (not companions), so remove by session originals list.
    const importedSet = new Set(files);
    state.scanItems = normalizeAndSortItems(
      state.scanItems.filter((it) => !importedSet.has(it.path))
    );

    // Re-group and re-render, keeping selection stable if possible
    applyScanItemsToUi({ preserveSessionId, preservePath });

    // 10) Human readable result (include delete counts if available)
    const primaryDeleted =
      delData.primaryDeleted ??
      delData.originalsDeleted ??
      delData.primaryCount ??
      "?";

    const deletedTotal =
      delData.deleted ??
      delData.targetCount ??
      "?";

    setLog(
      `Import OK + Source deleted\n` +
      `targetRoot: ${out.targetRoot || targetRoot}\n` +
      `sessionDir: ${out.sessionDir || "(unknown)"}\n` +
      `exportsDir: ${out.exportsDir || "(unknown)"}\n` +
      `exportSessionDir: ${out.exportSessionDir || "(missing)"}\n` +
      `sessionJson: ${out.sessionJsonFile || "(n/a)"}\n` +
      `logFile: ${out.logFile || "(unknown)"}\n` +
      `copied: ${out.copied ?? "?"}, skipped: ${out.skipped ?? "?"}\n` +
      `deleted (source): ${primaryDeleted}/${deletedTotal}\n`
    );
  } catch (e) {
    setLog({ error: "Import failed", details: e });
    logLine("[import] failed", e);
  } finally {
    // 11) Always restore UI gating + refresh header
    setBusy({ importing: false });
    uiRenderHeader();
    uiUpdateImportEnabled();
  }
}

/**
 * Delete the currently selected image (and its companions) by moving it into
 * a hidden trash folder under the selected sourceRoot.
 *
 * Server contract (current):
 * POST /api/delete
 * Body: { file: <absolutePath>, sourceRoot: <absolutePath> }
 * Response: { ok, sourceRoot, trashedTo, moved:[{from,to}], skipped:[], errors:[] }
 *
 * Client responsibilities:
 * - Validate required UI state (session + selected file + sourceRoot)
 * - Confirm destructive action
 * - Call API via apiDeleteFile()
 * - On success: remove ONLY the original from scanItems (companions are not in scanItems)
 * - Re-group sessions and keep selection stable
 */
async function deleteCurrentImage() {
  // 1) Guard: keep UI predictable by requiring a selected session
  const s = getSelectedSession();
  if (!s) return setLog("Delete aborted: No session selected.");

  // 2) Guard: must have a selected image (thumbnail click sets this)
  const deletingPath = String(state.currentFilePath || "").trim();
  if (!deletingPath) {
    return setLog("Delete aborted: No image selected. Click a thumbnail first.");
  }

  // 3) Guard: server enforces safety boundaries via sourceRoot
  const sourceRoot = String(state.sourceRoot || "").trim();
  if (!sourceRoot) {
    return setLog("Delete aborted: sourceRoot missing. Select a source folder first.");
  }

  // 4) Confirm destructive action
  const name = deletingPath.split("/").pop() || deletingPath;
  if (!confirm(`Delete (move to trash): ${name}?`)) return;

  // Preserve context before mutations (re-grouping can reindex)
  const preserveSessionId = s.id ?? null;
  const preservePath = deletingPath;

  // 5) Disable conflicting actions while delete is in-flight
  setBusy({ deleting: true });

  try {
    // 6) Call delete endpoint (API helper throws on non-2xx)
    const data = await apiDeleteFile(
      { file: deletingPath, sourceRoot },
      { logLine }
    );

    // 7) Success: remove the deleted ORIGINAL from scanItems
    // Companions are not in scanItems, so we remove by exact original path.
    state.scanItems = normalizeAndSortItems(
      state.scanItems.filter((it) => it.path !== deletingPath)
    );

    // 8) Rebuild sessions and keep selection stable if possible
    applyScanItemsToUi({ preserveSessionId, preservePath });

    // 9) Choose a reasonable next preview image (first item in current session)
    const s2 = getSelectedSession();
    if (s2?.items?.length) {
      uiSetCurrentImage(s2.items[0]);
    } else {
      uiSetCurrentImage(null);
      clearEl(els.thumbStrip);
    }

    // 10) UX message: support legacy + current server fields
    const movedTo =
      data?.movedTo ||          // legacy
      data?.trashedTo ||        // current preferred
      data?.moved?.[0]?.to ||   // fallback
      "(unknown)";

    const movedCount = Array.isArray(data?.moved) ? data.moved.length : 0;
    const missing = Number.isFinite(data?.missing) ? data.missing : 0;

    setLog(
      `Deleted: ${name}\n` +
      `Moved to: ${movedTo}\n` +
      `Files moved: ${movedCount}\n` +
      `Missing: ${missing}`
    );

    logLine("[delete] ok", data);
  } catch (err) {
    // apiDeleteFile() should throw a structured object (status/data), but be tolerant.
    setLog({ error: "Delete failed", details: err });
    logLine("[delete] failed", err);
  } finally {
    // 11) Always restore UI gating + refresh header
    setBusy({ deleting: false });
    uiRenderHeader();
  }
}
/* ======================================================
   13) TIMERS / POLLING
====================================================== */

function startProgressPolling() {
  stopProgressPolling();

  state.progressTimer = setInterval(async () => {
    try {
      const p = await apiScanProgress({ logLine });

      if (!p || !p.total || p.total <= 0) {
        els.progressBar?.removeAttribute("value");
        return;
      }

      if (els.progressBar) {
        els.progressBar.value = Math.round((p.current / p.total) * 100);
      }
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

/* ======================================================
   14) SOURCE PICKER MODAL (candidate for public/lib/sourcePicker.js)
====================================================== */

function showSourcePickerModal() {
  if (!els.sourcePickerModal) {
    logLine("[sourcePicker] modal missing in DOM");
    return;
  }
  const modal = bootstrap.Modal.getOrCreateInstance(els.sourcePickerModal, {
    backdrop: true,
    focus: true,
  });
  modal.show();
}

function hideSourcePickerModal() {
  if (!els.sourcePickerModal) return;
  const modal = bootstrap.Modal.getInstance(els.sourcePickerModal);
  modal?.hide();
}

function setActiveListItem(el) {
  els.srcPickerList?.querySelectorAll(".list-group-item").forEach((x) => x.classList.remove("active"));
  el.classList.add("active");
}

function renderSourcePicker({ path: cwd, parent, directories } = {}) {
  // Stable picker state
  if (!state._srcPicker) state._srcPicker = { cwd: "/", selected: "/" };

  const safeCwd = String(cwd || "/");
  const safeParent = parent ? String(parent) : null;

  state._srcPicker.cwd = safeCwd;
  // Keep current selection if it’s still inside this view; otherwise default to cwd
  if (!state._srcPicker.selected || state._srcPicker.selected === "__ROOTS__") {
    state._srcPicker.selected = safeCwd;
  }

  // Header path + reset list
  setText(els.srcPickerPath, safeCwd);
  clearEl(els.srcPickerList);

  // “Use this folder” is always valid: selects current folder by default
  if (els.srcPickerSelectBtn) els.srcPickerSelectBtn.disabled = false;

  // Up button (no-op on ROOTS or if parent missing)
  if (els.srcPickerUpBtn) {
    const disableUp = !safeParent || safeParent === safeCwd || safeCwd === "ROOTS";
    els.srcPickerUpBtn.disabled = disableUp;
    els.srcPickerUpBtn.onclick = disableUp ? null : () => openSourceFolderBrowser(safeParent);
  }

  // Render directory items
  const list = Array.isArray(directories) ? directories : [];
  for (const d of list) {
    if (!d?.name || !d?.path) continue;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "list-group-item list-group-item-action";
    btn.textContent = d.name;

    // Single click = select
    btn.addEventListener("click", () => {
      state._srcPicker.selected = d.path;
      setActiveListItem(btn);
      if (els.srcPickerSelectBtn) els.srcPickerSelectBtn.disabled = false;
    });

    // Double click = enter directory
    btn.addEventListener("dblclick", () => openSourceFolderBrowser(d.path));

    // Preselect if it matches current selection
    if (state._srcPicker.selected === d.path) {
      btn.classList.add("active");
    }

    els.srcPickerList?.appendChild(btn);
  }

  // Confirm selection -> set source root, close modal, auto-scan
  if (els.srcPickerSelectBtn) {
    els.srcPickerSelectBtn.onclick = async () => {
      const chosen = state._srcPicker?.selected || state._srcPicker?.cwd || "/";
      setSourceRoot(chosen);
      hideSourcePickerModal();

      // start scan immediately
      await runScan();
    };
  }
}

async function openSourceFolderBrowser(startPath = "/") {
  try {
    const data = await apiBrowseFs(startPath, { logLine });
    renderSourcePicker({
      path: data.path,
      parent: data.parent,
      directories: data.directories,
    });
    showSourcePickerModal();
  } catch (e) {
    setLog({ error: "Source folder browse failed", details: e });
    logLine("[fsbrowse] failed", e);
  }
}

/**
 * Delete the currently selected session from the SOURCE (and all companion files)
 * by calling the server endpoint:
 *
 *   POST /api/delete-session
 *   Body: { sourceRoot: string, files: string[] }
 *
 * ??? Key behaviors:
 * - Guards against missing selection / missing sourceRoot.
 * - Confirms with the user (destructive action).
 * - Preserves selection context (session id + current image) so the UI remains stable
 *   after we remove items and re-group sessions.
 * - Handles multiple server response shapes (older/newer versions).
 * - Updates scanItems -> re-groups -> refreshes preview.
 */


/**
 * Delete a session from SOURCE (originals + companions) via:
 *   POST /api/delete-session
 *
 * By default it uses the currently selected session and asks for confirmation.
 * Import flow can call it with { skipConfirm:true, filesOverride:[...], preserveSessionId, preservePath }.
 */
async function deleteCurrentSession(opts = {}) {
  const {
    skipConfirm = false,
    filesOverride = null,
    preserveSessionId = null,
    preservePath = null,
    sourceRootOverride = null,
  } = opts;

  // 1) Determine what we delete
  const s = getSelectedSession();
  const files = Array.isArray(filesOverride)
    ? filesOverride
    : (Array.isArray(s?.items) ? s.items : []);

  if (!files.length) return setLog("Delete session aborted: Session has no files.");

  // 2) Safety boundary required by server
  const sourceRoot = String(sourceRootOverride ?? state.sourceRoot ?? "").trim();
  if (!sourceRoot) {
    return setLog("Delete session aborted: sourceRoot missing. Select a source folder first.");
  }

  // 3) Confirm destructive action (unless import calls skipConfirm)
  if (!skipConfirm) {
    const msg =
      `Delete entire session?\n\n` +
      `Files: ${files.length}\n` +
      (s ? `Range: ${fmtRange(s.start, s.end)}\n\n` : "\n") +
      `This will also delete companion files (.xmp, .on1, .onphoto, etc.).`;

    if (!confirm(msg)) return;
  }

  // 4) Preserve UI context before mutation
  const keepSessionId = preserveSessionId ?? (s?.id ?? null);
  const keepPath = preservePath ?? (state.currentFilePath ?? null);

  setBusy({ deleting: true });

  try {
    const res = await fetch("/api/delete-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceRoot, files }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setLog({ error: "Delete session failed", status: res.status, data });
      logLine("[delete-session] failed", { status: res.status, data });
      return null;
    }

    // Remove deleted originals from scanItems (companions are not in scanItems)
    const deletedSet = new Set(files);
    state.scanItems = normalizeAndSortItems(
      state.scanItems.filter((it) => !deletedSet.has(it.path))
    );

    applyScanItemsToUi({ preserveSessionId: keepSessionId, preservePath: keepPath });

    uiSetCurrentImage(null);
    clearEl(els.thumbStrip);

    // Best-effort summary across server versions
    const missing = data.missing ?? 0;
    const primary = data.originalsDeleted ?? data.primaryCount ?? "?";
    const total = data.deleted ?? data.targetCount ?? "?";
    const companions =
      data.companionsDeleted ??
      (Number.isFinite(total) && Number.isFinite(primary) ? Math.max(0, total - primary) : "?");

    setLog(
      `Session deleted\n` +
      `primary (originals): ${primary}\n` +
      `companions: ${companions}\n` +
      `deleted total: ${total}\n` +
      `missing: ${missing}\n`
    );

    logLine("[delete-session] ok", data);
    return data;
  } catch (err) {
    setLog({ error: "Delete session exception", err: String(err) });
    logLine("[delete-session] exception", err);
    return null;
  } finally {
    setBusy({ deleting: false });
    uiRenderHeader();
  }
}

/* ======================================================
   15) EVENT WIRING + BOOT
====================================================== */

on(els.selSrcBtn, "click", () => {
  const start = state.sourceRoot && state.sourceRoot !== "/" ? state.sourceRoot : defaultMacStartPath();
  openSourceFolderBrowser(start);
});

on(els.importBtn, "click", importSelectedSession);
on(els.deleteBtn, "click", deleteCurrentImage);

on(els.delSessionBtn, "click", deleteCurrentSession);

on(els.sessions, "change", onSessionChange);
on(els.gapSlider, "input", () => regroupSessionsAndRerender());

on(els.title, "input", () => {
  state.userTouchedTitle = true;
});

// Boot: make slider usable before first scan
uiApplyGapPresets(uniqueSorted(APP.FALLBACK_GAP_PRESETS_MS), { keepNearest: true });

// Boot: config
loadConfig().catch((e) => {
  setLog(e);
  logLine("[config] load failed", e);
});

window.addEventListener("beforeunload", () => {
  stopProgressPolling();
  logger.flush?.(); // best-effort
});