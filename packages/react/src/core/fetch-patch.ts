/**
 * Optional `propagateHeaders`: stamps `X-Nexus-Session` / `X-Nexus-Page-View` on the app's own
 * API calls so the backend SDK can join server requests to the page view that caused them.
 *
 * RULES
 * - `window.fetch` is patched ONCE, however many trackers ask; restored when the LAST one releases.
 * - ONLY same-origin requests get the headers (never leak ids to third parties, never trigger a
 *   CORS preflight on someone else's API). The ingest URL itself is skipped (it must stay a simple
 *   request).
 * - Headers the caller already set are never overwritten.
 * - If anything goes wrong, the original request is sent untouched. NEVER throws.
 */
import { globalState } from './global-state';

export interface HeaderSource {
  /** Current headers to add, or undefined to add nothing. */
  headers(): Record<string, string> | undefined;
  /** Absolute URL that must NOT be decorated (the ingest endpoint). */
  excludeUrl: string;
}

type PatchedFetch = typeof fetch & { __nexusOriginal?: typeof fetch };

/** WHY: returns a release function; the patch is removed when no source is left. */
export function installFetchPatch(source: HeaderSource): () => void {
  try {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return noop;
    const state = globalState().fetchPatch;
    state.sources.add(source);
    if (!state.patched) {
      const original = window.fetch;
      const patched = createPatchedFetch(original) as PatchedFetch;
      patched.__nexusOriginal = original;
      state.original = original;
      state.patched = patched;
      window.fetch = patched;
    }
    return () => releaseFetchPatch(source);
  } catch {
    return noop;
  }
}

function releaseFetchPatch(source: HeaderSource): void {
  try {
    const state = globalState().fetchPatch;
    state.sources.delete(source);
    if (state.sources.size > 0 || !state.patched) return;
    // Only restore if nobody wrapped fetch after us; otherwise our wrapper stays as a pass-through.
    if (window.fetch === state.patched && state.original) window.fetch = state.original;
    state.patched = undefined;
    state.original = undefined;
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

/** WHY: returns a new init with the headers added, or undefined when the request is left alone. */
function decorate(input: RequestInfo | URL, init: RequestInit | undefined): RequestInit | undefined {
  const source = activeSource();
  if (!source) return undefined;
  const url = requestUrl(input);
  if (!isSameOrigin(url) || isExcluded(url, source.excludeUrl)) return undefined;
  const extra = source.headers();
  if (!extra) return undefined;
  const baseHeaders = init?.headers ?? (isRequest(input) ? input.headers : undefined);
  const headers = new Headers(baseHeaders);
  for (const [name, value] of Object.entries(extra)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return { ...init, headers };
}

/** WHY: the newest tracker wins (normally there is exactly one). */
function activeSource(): HeaderSource | undefined {
  let last: HeaderSource | undefined;
  for (const source of globalState().fetchPatch.sources) last = source as HeaderSource;
  return last;
}

function isRequest(input: unknown): input is Request {
  return typeof Request !== 'undefined' && input instanceof Request;
}

function requestUrl(input: RequestInfo | URL): string {
  if (isRequest(input)) return input.url;
  if (input instanceof URL) return input.href;
  return String(input);
}

/** WHY: relative URLs resolve against the page; anything on another origin is left alone. */
export function isSameOrigin(url: string): boolean {
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

function isExcluded(url: string, excludeUrl: string): boolean {
  try {
    const target = new URL(url, window.location.href);
    const excluded = new URL(excludeUrl, window.location.href);
    return target.origin === excluded.origin && target.pathname === excluded.pathname;
  } catch {
    return true;
  }
}

function noop(): void {}
