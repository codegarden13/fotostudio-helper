// app/lib/util.js
export function isNonEmptyString(x) {
  return typeof x === "string" && x.trim().length > 0;
}

export function uniqStrings(list) {
  const out = [];
  const seen = new Set();

  for (const v of list || []) {
    const s = String(v || "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}


export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

export const fmt = (ts) =>
  new Date(ts).toISOString().replace("T", " ").slice(0, 16);

export function uniqueSorted(arr) {
  return Array.from(new Set(arr.filter((x) => Number.isFinite(x) && x > 0))).sort(
    (a, b) => a - b
  );
}

export function normalizeAndSortItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((it) => ({ path: it?.path, ts: Number(it?.ts) }))
    .filter((it) => it.path && Number.isFinite(it.ts))
    .sort((a, b) => a.ts - b.ts);
}

export function msToLabel(ms) {
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

export function fmtRange(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "–";
  const a = fmt(start);
  const b = fmt(end);
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

/**
 * Compute gap presets (ms) from sorted timestamps.
 * Pure: depends only on `items` and params; no DOM/state.
 */
export function computeGapPresetsFromItems(
  items,
  {
    steps = 11,
    topK = 6,
    minFloorMs = 1000,
  } = {}
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
    [...base, ...snapped, ...largest, maxDiff, span].map((x) =>
      Math.max(minFloorMs, Math.min(span, x))
    )
  );

  if (out[out.length - 1] !== span) out.push(span);
  return uniqueSorted(out);
}

/**
 * Group items by time gap into sessions (client-side).
 * Pure: no DOM/state.
 */
export function groupSessionsClient(items, gapMs) {
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