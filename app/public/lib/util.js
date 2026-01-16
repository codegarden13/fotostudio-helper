// app/public/lib/util.js
//
// Pure, stateless helpers for the frontend.
// Keep this file free of DOM/state and server concerns.

export function isNonEmptyString(x) {
  return typeof x === "string" && x.trim().length > 0;
}

/**
 * Return unique, trimmed, non-empty strings (preserves first-seen order).
 */
export function uniqStrings(list) {
  const out = [];
  const seen = new Set();

  for (const v of list || []) {
    const s = String(v ?? "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Format timestamp (ms) as "YYYY-MM-DD HH:MM" in ISO-like format.
 */
export function fmt(ts) {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return "–";
  return d.toISOString().replace("T", " ").slice(0, 16);
}

/**
 * Unique + numeric filter + ascending sort.
 */
export function uniqueSorted(arr) {
  const nums = Array.isArray(arr) ? arr : [];
  return Array.from(new Set(nums.filter((x) => Number.isFinite(x) && x > 0))).sort(
    (a, b) => a - b
  );
}

/**
 * Normalize scan items to the canonical shape expected by the UI:
 *   { path: string, ts: number }
 *
 * - Filters out invalid entries
 * - Sorts by ts asc
 */
export function normalizeAndSortItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((it) => ({ path: it?.path, ts: Number(it?.ts) }))
    .filter((it) => isNonEmptyString(it.path) && Number.isFinite(it.ts))
    .sort((a, b) => a.ts - b.ts);
}

/**
 * Human readable label for milliseconds.
 */
export function msToLabel(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "–";

  const s = n / 1000;
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

export function fmtRange(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "–";
  const a = fmt(start);
  const b = fmt(end);
  if (a === "–" || b === "–") return "–";

  const dayA = a.slice(0, 10);
  const dayB = b.slice(0, 10);
  if (dayA === dayB) return `${dayA} ${a.slice(11)}–${b.slice(11)}`;
  return `${a}–${b}`;
}

export function formatExposureParts({ shutter, aperture, iso } = {}) {
  const parts = [];
  if (shutter) parts.push(`⏱ ${shutter}`);
  if (aperture) parts.push(`ƒ/${aperture}`);
  if (iso) parts.push(`ISO ${iso}`);
  return parts;
}

/* ======================================================
   Gap analysis helpers (pure)
====================================================== */

/**
 * Compute inter-item gaps in milliseconds from items (expects {ts}).
 * Items are sorted defensively by ts asc.
 */
export function computeInterItemGapsMs(items) {
  const arr = Array.isArray(items) ? items : [];
  if (arr.length < 2) return [];

  const sorted = [...arr]
    .map((it) => Number(it?.ts))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  const gaps = [];
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i] - sorted[i - 1];
    if (d > 0) gaps.push(d);
  }
  return gaps;
}

/**
 * Quantile over a sorted numeric array (linear interpolation).
 * q in [0,1].
 */
export function quantileSorted(sorted, q) {
  const arr = Array.isArray(sorted) ? sorted : [];
  const n = arr.length;
  if (!n) return null;

  const qq = Math.min(1, Math.max(0, Number(q)));
  if (qq <= 0) return arr[0];
  if (qq >= 1) return arr[n - 1];

  const pos = (n - 1) * qq;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return arr[lo];

  const w = pos - lo;
  return Math.round(arr[lo] * (1 - w) + arr[hi] * w);
}

/**
 * Slider position t -> quantile q, using a concave curve to
 * allocate more resolution to small gaps.
 *
 * gamma > 1: more resolution near 0
 */
export function sliderToQuantile(t, gamma = 2.5) {
  const tt = Math.min(1, Math.max(0, Number(t)));
  return Math.pow(tt, gamma);
}

/**
 * Inverse mapping quantile q -> slider position t.
 */
export function quantileToSlider(q, gamma = 2.5) {
  const qq = Math.min(1, Math.max(0, Number(q)));
  return Math.pow(qq, 1 / gamma);
}

/**
 * Convert a desired gapMs to an approximate quantile in a sorted gap array.
 * Returns q in [0,1].
 */
export function gapMsToQuantile(sortedGaps, gapMs) {
  const arr = Array.isArray(sortedGaps) ? sortedGaps : [];
  if (!arr.length) return 0.5;

  const target = Number(gapMs);
  if (!Number.isFinite(target) || target <= 0) return 0;

  // lower_bound
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid;
  }

  if (arr.length === 1) return 0;
  return lo / (arr.length - 1);
}

/**
 * Given items and a quantile q, return a gapMs value derived from real gaps.
 * Falls back to defaultGapMs if no gaps exist.
 */
export function gapMsFromItemsByQuantile(items, q, defaultGapMs = 30 * 60 * 1000) {
  const gaps = computeInterItemGapsMs(items)
    .filter((x) => Number.isFinite(x) && x > 0)
    .sort((a, b) => a - b);

  if (!gaps.length) return defaultGapMs;

  const ms = quantileSorted(gaps, q);
  return Number.isFinite(ms) && ms > 0 ? ms : defaultGapMs;
}

/* ======================================================
   Legacy preset computation (kept for now)
   You can delete this once the UI fully migrates to quantile mapping.
====================================================== */

/**
 * Compute gap presets (ms) from sorted timestamps.
 * Pure: depends only on `items` and params; no DOM/state.
 */
export function computeGapPresetsFromItems(
  items,
  { steps = 11, topK = 6, minFloorMs = 1000 } = {}
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
    let lo = 0;
    let hi = diffs.length - 1;
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
    [...base, ...snapped, ...largest, maxDiff, span].map((x) =>
      Math.max(minFloorMs, Math.min(span, x))
    )
  );

  if (out[out.length - 1] !== span) out.push(span);
  return uniqueSorted(out);
}

/* ======================================================
   Session grouping (client-side)
====================================================== */

/**
 * Group items by time gap into sessions (client-side).
 * Pure: no DOM/state.
 */
export function groupSessionsClient(items, gapMs) {
  const arr = Array.isArray(items) ? items : [];
  const gap = Number(gapMs);

  if (!arr.length) return [];
  if (!Number.isFinite(gap) || gap < 0) return [];

  const groups = [];
  let cur = [];

  for (const it of arr) {
    if (!cur.length || it.ts - cur[cur.length - 1].ts <= gap) {
      cur.push(it);
    } else {
      groups.push(cur);
      cur = [it];
    }
  }
  if (cur.length) groups.push(cur);

  return groups.map((g, i) => {
    const start = g[0]?.ts;
    const end = g[g.length - 1]?.ts;
    const examplePath = g[0]?.path || "";
    return {
      id: String(i + 1),
      start,
      end,
      count: g.length,
      examplePath,
      exampleName: examplePath.split("/").pop(),
      items: g.map((x) => x.path),
    };
  });
}