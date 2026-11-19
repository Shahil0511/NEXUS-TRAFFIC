/**
 * Header propagation on `window.fetch` (ADR 0011).
 *
 * RULES
 * - `window.fetch` is patched ONCE, however many sources exist (early entry, trackers).
 * - Which request gets which headers is decided per call by the active `HeaderSource`
 *   (`header-source.ts`): same-origin or allow-listed, never the ingest URLs, live kill gating.
 * - Headers the caller already set are never overwritten; a Request input keeps its referrer
 *   and referrer policy.
 * - Only the decoration is inside try/catch: the original fetch is called exactly once, outside
 *   it, so its own errors reach the caller unchanged. Our errors never do.
 */
import { globalState } from './global-state';
import { headerSourceFor } from './header-source';

export { isExcluded, isSameOrigin } from './header-source';

type PatchedFetch = typeof fetch & { __nexusOriginal?: typeof fetch };

/** WHY: idempotent; the caller has already captured the native fetch (`captureNativeFetch`). */
export function installFetchPatch(): void {
  try {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
    const state = globalState();
    if (state.fetchPatch) return;
    const original = window.fetch;
    const patched = createPatchedFetch(original) as PatchedFetch;
    patched.__nexusOriginal = original;
    state.fetchPatch = { original, patched };
    window.fetch = patched;
  } catch {
    // never throw into the host app
  }
}

/**
 * WHY: restore only if nobody wrapped fetch after us. Otherwise our wrapper stays in their chain
 * as a pass-through (it is gated live), and the state is kept so it is never installed twice.
 */
export function releaseFetchPatchIfOurs(): void {
  try {
    const state = globalState();
    const patch = state.fetchPatch;
    if (!patch || typeof window === 'undefined') return;
    if (window.fetch !== patch.patched) return;
    window.fetch = patch.original;
    state.fetchPatch = null;
  } catch {
    // never throw
  }
}

function createPatchedFetch(original: typeof fetch): typeof fetch {
  return function nexusFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let decoratedInit: RequestInit | undefined;
    try {
      decoratedInit = decorate(input, init);
    } catch {
      decoratedInit = undefined;
    }
    return original.call(globalThis, input, decoratedInit ?? init);
  };
}

/**
 * WHY: returns a new init with the headers added, or undefined when the request is left alone.
 * For a Request input, a non-empty init makes `new Request(request, init)` reset the referrer and
 * the referrer policy (Fetch spec) — so the Request's own values are carried over unless the
 * caller's init sets them.
 */
function decorate(input: RequestInfo | URL, init: RequestInit | undefined): RequestInit | undefined {
  const source = headerSourceFor(requestUrl(input));
  if (!source) return undefined;
  const extra = source.headers();
  const baseHeaders = init?.headers ?? (isRequest(input) ? input.headers : undefined);
  const headers = new Headers(baseHeaders);
  for (const [name, value] of Object.entries(extra)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return { ...referrerOf(input), ...init, headers };
}

/** The referrer / referrerPolicy of a Request input (the caller's `init` spreads over them). */
function referrerOf(input: RequestInfo | URL): RequestInit {
  return isRequest(input) ? { referrer: input.referrer, referrerPolicy: input.referrerPolicy } : {};
}

function isRequest(input: unknown): input is Request {
  return typeof Request !== 'undefined' && input instanceof Request;
}

function requestUrl(input: RequestInfo | URL): string {
  if (isRequest(input)) return input.url;
  if (input instanceof URL) return input.href;
  return String(input);
}
