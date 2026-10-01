/**
 * WHY: the ONE way a batch leaves the browser.
 * - `navigator.sendBeacon` survives page unload (pagehide) and never blocks navigation.
 * - The Blob type is `text/plain` so the request stays a CORS "simple request": no preflight, and
 *   the SSO cookie travels with it (same site). The key is in the BODY for the same reason.
 * - If the beacon is refused (queue full, too large, missing API) → `fetch` with `keepalive`.
 * - Browser beacons are NOT retried: a lost batch loses a few events, never double-counts.
 * NEVER throws.
 */
const CONTENT_TYPE = 'text/plain;charset=UTF-8';

export type Transport = (url: string, json: string) => void;

export const beaconTransport: Transport = (url, json) => {
  try {
    if (sendWithBeacon(url, json)) return;
    sendWithFetch(url, json);
  } catch {
    // A failed beacon is simply lost — never surface tracker errors to the host app.
  }
};

function sendWithBeacon(url: string, json: string): boolean {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return false;
    return navigator.sendBeacon(url, new Blob([json], { type: CONTENT_TYPE }));
  } catch {
    return false;
  }
}

function sendWithFetch(url: string, json: string): void {
  const fetchFn = originalFetch();
  if (!fetchFn) return;
  void fetchFn(url, {
    method: 'POST',
    body: json,
    keepalive: true,
    credentials: 'include',
    headers: { 'Content-Type': CONTENT_TYPE },
  }).catch(() => undefined);
}

/**
 * WHY: when `propagateHeaders` patched `window.fetch`, the fallback must still use the untouched
 * fetch (the patch skips the ingest URL anyway, this is belt and braces).
 */
function originalFetch(): typeof fetch | undefined {
  const patched = globalThis.fetch as (typeof fetch & { __nexusOriginal?: typeof fetch }) | undefined;
  return patched?.__nexusOriginal ?? patched;
}
