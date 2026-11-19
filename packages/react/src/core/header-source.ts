/**
 * Header propagation sources (ADR 0011): WHAT to stamp on the app's own API calls, and WHETHER.
 *
 * WHY: `X-Nexus-Session` / `X-Nexus-Page-View` let the backend SDK join a server request to the
 * page view that caused it. The fetch and XHR patches only ask `shouldDecorate()` and
 * `headers()`; every rule lives here:
 * - same-origin requests (relative URLs resolved like fetch does, against `document.baseURI`),
 *   plus EXACT origins the app listed in `propagateHeadersTo` (on ANY live source: the per-request
 *   choice is `headerSourceFor(url)`);
 * - the decision looks at the INITIAL url only: a same-origin request the server redirects to
 *   another origin keeps the headers, so that target's CORS must allow them (or turn
 *   `propagateHeaders` off) — see the README;
 * - never the SDK's own ingest/config URLs;
 * - LIVE gating: the kill switch and a remote `header_propagation` switch take effect on the very
 *   next request, even for the permanent early source.
 */
import { INGEST_HEADERS } from '@nexus/shared/constants';

import { globalState, sharedSessionStore } from './global-state';

export interface HeaderSource {
  /** `keyScope(publishableKey)` of the install that owns this source. */
  keyScope: string;
  /** Absolute URLs that are never decorated (the collector's ingest endpoints). */
  excludeUrls: readonly string[];
  /** Normalised origins (`https://api.example.com`) that may also get the headers. */
  allowOrigins: readonly string[];
  headers(): Record<string, string>;
}

export interface HeaderSourceOptions {
  keyScope: string;
  excludeUrls: readonly string[];
  allowOrigins: readonly string[];
  /** The page view to pair with the session, or null before the first one. */
  pageView: () => { id: string; sessionId: string } | null;
}

/**
 * WHY: the session id comes from the ONE shared store (`peekCurrent`: idle rotation only). The
 * page-view header is added only when the view belongs to that session — a rotated session must
 * never be paired with a page view of the old one.
 */
export function createHeaderSource(options: HeaderSourceOptions): HeaderSource {
  return {
    keyScope: options.keyScope,
    excludeUrls: options.excludeUrls,
    allowOrigins: normaliseOrigins(options.allowOrigins),
    headers() {
      const sid = sharedSessionStore().peekCurrent(Date.now());
      const headers: Record<string, string> = { [INGEST_HEADERS.session]: sid };
      const view = options.pageView();
      if (view && view.sessionId === sid) headers[INGEST_HEADERS.pageView] = view.id;
      return headers;
    },
  };
}

/** WHY: the single decision "does this request get our headers?". */
export function shouldDecorate(url: string, source: HeaderSource): boolean {
  if (isExcluded(url, source.excludeUrls)) return false;
  if (!isSameOrigin(url) && !source.allowOrigins.includes(originOf(url) ?? '')) return false;
  return isPropagationAllowed(source);
}

/**
 * WHY: read LIVE on every call (never cached at install time), so a kill or a remote
 * `header_propagation` switch stops decoration in the current page.
 */
export function isPropagationAllowed(source: HeaderSource): boolean {
  const state = globalState();
  if (state.disabledKeys.has(source.keyScope)) return false;
  return !state.remote.get(source.keyScope)?.disabledModules.includes('header_propagation');
}

/**
 * WHY: decided PER REQUEST — the newest source that would decorate THIS url. A tracker mounted
 * without `propagateHeadersTo` must not silently cancel the early install's allow-list for
 * another-origin API (the newest source alone would refuse that origin).
 */
export function headerSourceFor(url: string): HeaderSource | undefined {
  let chosen: HeaderSource | undefined;
  for (const source of globalState().headerSources) {
    if (shouldDecorate(url, source)) chosen = source;
  }
  return chosen;
}

/**
 * WHY: relative URLs resolve against the document base URL (`<base href>`) exactly like fetch and
 * XHR do; anything on another origin is left alone.
 */
export function isSameOrigin(url: string): boolean {
  try {
    return new URL(url, documentBaseUrl()).origin === window.location.origin;
  } catch {
    return false;
  }
}

/** WHY: an unparsable URL counts as excluded (never decorate what we cannot reason about). */
export function isExcluded(url: string, excludeUrls: readonly string[]): boolean {
  try {
    const base = documentBaseUrl();
    const target = new URL(url, base);
    return excludeUrls.some((excluded) => {
      const e = new URL(excluded, base);
      return target.origin === e.origin && trimSlash(target.pathname) === trimSlash(e.pathname);
    });
  } catch {
    return true;
  }
}

function originOf(url: string): string | undefined {
  try {
    return new URL(url, documentBaseUrl()).origin;
  } catch {
    return undefined;
  }
}

/** WHY: `document.baseURI` honours `<base href>`; fall back to the page URL (callers catch). */
function documentBaseUrl(): string {
  return (typeof document !== 'undefined' && document.baseURI) || window.location.href;
}

/** WHY: `https://API.example.com/` and `https://api.example.com` are the same origin. */
function normaliseOrigins(origins: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of origins) {
    try {
      const origin = new URL(raw).origin;
      if (origin && origin !== 'null' && !out.includes(origin)) out.push(origin);
    } catch {
      // an invalid entry is ignored
    }
  }
  return out;
}

function trimSlash(pathname: string): string {
  return pathname.replace(/\/+$/, '');
}
