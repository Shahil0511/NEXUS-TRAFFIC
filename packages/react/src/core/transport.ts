/**
 * WHY: the ONE way a batch leaves the browser, and the ONE place its outcome is classified.
 * - `live` (timer, size trigger, route change): the CAPTURED native fetch (never a host
 *   interceptor) with `keepalive`, so the status is readable and failures can be retried.
 *   If fetch is missing or throws synchronously → the beacon. A request that has not answered
 *   (headers AND error body) within `SDK_DEFAULTS.browser.ingestTimeoutMs` is aborted and counts as
 *   `retry_opaque` — a blackholed collector must not block the single-flight queue for minutes.
 * - `unload` (`hidden` / `pagehide`): `navigator.sendBeacon` survives the page; `true` counts as
 *   delivered. A refused beacon falls back to the keepalive fetch.
 * - The body is `text/plain` so the request stays a CORS "simple request" (no preflight, the SSO
 *   cookie travels with it). The key is in the BODY for the same reason.
 * NEVER throws and never rejects.
 */
import { SDK_DEFAULTS } from '@nexus/shared/constants';
import { ERROR_CODES, SDK_KILL_ERROR_CODES } from '@nexus/shared/errors';

import { globalState } from './global-state';

export const CONTENT_TYPE = 'text/plain;charset=UTF-8';

export type SendMode = 'live' | 'unload';

/**
 * - `delivered`: 2xx (or an accepted beacon).
 * - `drop`: the batch will never be accepted as it is (400, 413, 415, ORIGIN_NOT_ALLOWED, …).
 * - `retry`: 429 / 5xx — back off, then persist.
 * - `retry_opaque`: network error / unreadable response — back off, persist at most once.
 * - `disabled`: a kill code (SDK_KILL_ERROR_CODES) — stop everything for this key.
 */
export type DeliveryOutcome = 'delivered' | 'drop' | 'retry' | 'retry_opaque' | 'disabled';

/** The SDK `Transport` port (tests inject a fake). */
export type Transport = (url: string, json: string, mode: SendMode) => Promise<DeliveryOutcome>;

export const defaultTransport: Transport = async (url, json, mode) => {
  try {
    if (mode === 'unload' && sendWithBeacon(url, json)) return 'delivered';
    const fetchFn = globalState().nativeFetch;
    const controller = typeof AbortController === 'undefined' ? undefined : new AbortController();
    let pending: Promise<Response>;
    try {
      if (!fetchFn) throw new Error('no fetch');
      pending = fetchFn.call(globalThis, url, {
        method: 'POST',
        body: json,
        keepalive: true,
        credentials: 'include',
        headers: { 'Content-Type': CONTENT_TYPE },
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch {
      if (mode === 'live' && sendWithBeacon(url, json)) return 'delivered';
      return 'retry_opaque';
    }
    return await withTimeout(
      pending.then((response) => outcomeOf(response)),
      SDK_DEFAULTS.browser.ingestTimeoutMs,
      () => controller?.abort(),
    );
  } catch {
    return 'retry_opaque';
  }
};

/**
 * WHY: the abort alone is not enough (a fake or old fetch may ignore the signal) — the outcome is
 * `retry_opaque` once the deadline passes, whatever the request does afterwards.
 */
function withTimeout(
  work: Promise<DeliveryOutcome>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<DeliveryOutcome> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        onTimeout();
      } catch {
        // never throw
      }
      resolve('retry_opaque');
    }, timeoutMs);
    work.then(
      (outcome) => {
        clearTimeout(timer);
        resolve(outcome);
      },
      () => {
        clearTimeout(timer);
        resolve('retry_opaque');
      },
    );
  });
}

/** WHY: an opaque or status-0 response says nothing — treated like a network error. */
export async function outcomeOf(response: Response): Promise<DeliveryOutcome> {
  if (response.type === 'opaque' || response.status === 0) return 'retry_opaque';
  const code =
    response.status === 401 || response.status === 403 ? await readErrorCode(response) : undefined;
  return classifyDelivery(response.status, code);
}

/** WHY: pure, so every rule of ADR 0012 is one line here and one assertion in the tests. */
export function classifyDelivery(status: number, code: string | undefined): DeliveryOutcome {
  if (status >= 200 && status < 300) return 'delivered';
  if ((status === 401 || status === 403) && isKillCode(code)) return 'disabled';
  if (status === 429 || status >= 500) return 'retry';
  if (status === 403 && code === ERROR_CODES.ORIGIN_NOT_ALLOWED) return 'drop';
  // 400, 413, 415 and every other 4xx: retrying the same body cannot succeed.
  return 'drop';
}

export function isKillCode(code: string | undefined): boolean {
  return code !== undefined && (SDK_KILL_ERROR_CODES as readonly string[]).includes(code);
}

/** WHY: `{ error: { code } }` — the codes only, never the message. */
export async function readErrorCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown } } | null;
    const code = body?.error?.code;
    return typeof code === 'string' ? code : undefined;
  } catch {
    return undefined;
  }
}

function sendWithBeacon(url: string, json: string): boolean {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return false;
    return navigator.sendBeacon(url, new Blob([json], { type: CONTENT_TYPE }));
  } catch {
    return false;
  }
}
