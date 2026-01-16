// public/lib/api.js
//
// Responsibilities:
// - Single place for all HTTP calls from the SPA
// - Consistent JSON parsing + error handling
// - Optional lightweight logging via injected callbacks
//
// Design:
// - `requestJson()` is the only "fetch wrapper".
// - Endpoint helpers (scan/import/delete/...) are thin and explicit.

function safeJson(res) {
  return res.json().catch(() => ({}));
}

/**
 * Fetch JSON and throw a structured error object if not OK.
 *
 * Throw shape:
 *   { status, url, method, data }
 *
 * This keeps callers simple:
 *   try { ... } catch (e) { setLog({ error: "...", details: e }) }
 */
export async function requestJson(url, init = {}, { logLine = null } = {}) {
  const method = String(init?.method || "GET").toUpperCase();

  try {
    const res = await fetch(url, init);
    const data = await safeJson(res);

    if (!res.ok) {
      const err = { status: res.status, url, method, data };
      if (typeof logLine === "function") logLine("[api] error", err);
      throw err;
    }

    return data;
  } catch (e) {
    // Network errors (no response) come here as exceptions (TypeError etc.)
    if (e && typeof e === "object" && "status" in e) throw e;

    const err = {
      status: 0,
      url,
      method,
      data: { error: "Network/Fetch error", details: String(e?.message || e) },
    };
    if (typeof logLine === "function") logLine("[api] exception", err);
    throw err;
  }
}

/* ======================================================
   Endpoint helpers (explicit, stable)
====================================================== */

export function apiGetConfig({ logLine = null } = {}) {
  return requestJson("/api/config", { cache: "no-store" }, { logLine });
}

export function apiBrowseFs(path, { logLine = null } = {}) {
  const p = String(path || "/");
  const url = `/api/fs/browse?path=${encodeURIComponent(p)}`;
  return requestJson(url, { method: "GET", cache: "no-store" }, { logLine });
}

export function apiScan(sourceRoot, { logLine = null } = {}) {
  return requestJson(
    "/api/scan",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceRoot }),
    },
    { logLine }
  );
}

export function apiScanProgress({ logLine = null } = {}) {
  return requestJson("/api/scan/progress", { cache: "no-store" }, { logLine });
}

export function apiExposure(path, { logLine = null } = {}) {
  const url = `/api/exposure?path=${encodeURIComponent(path)}`;
  return requestJson(url, { cache: "no-store" }, { logLine });
}

export function apiImport(payload, { logLine = null } = {}) {
  return requestJson(
    "/api/import",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    },
    { logLine }
  );
}

export function apiDeleteFile({ file, sourceRoot }, { logLine = null } = {}) {
  return requestJson(
    "/api/delete",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file, sourceRoot }),
    },
    { logLine }
  );
}

export function apiDeleteSession({ sourceRoot, files }, { logLine = null } = {}) {
  return requestJson(
    "/api/delete-session",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceRoot, files }),
    },
    { logLine }
  );
}