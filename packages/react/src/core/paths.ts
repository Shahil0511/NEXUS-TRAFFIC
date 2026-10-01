/**
 * Path helpers for the browser contract.
 *
 * WHY: every event `path` MUST include the app's base path and MUST NOT carry a query string or
 * hash (PII lives there). The referrer is reported as a HOST only — never a full URL.
 */
import { INGEST_LIMITS } from '@nexus/shared/constants';

/** WHY: turns whatever the router gives us into a contract-valid wire path. */
export function toWirePath(raw: string): string {
  const withoutQuery = raw.split(/[?#]/, 1)[0] ?? '';
  const absolute = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
  return absolute.slice(0, INGEST_LIMITS.maxWirePathLength);
}

/**
 * WHY: Next's `usePathname()` and react-router's `useLocation()` both EXCLUDE the base path, but
 * the collector checks every path starts with the app's base path (PATH_OUTSIDE_APP otherwise).
 *   joinBasePath('/my-app', '/audits') → '/my-app/audits'
 *   joinBasePath('/my-app', '/')       → '/my-app'
 *   joinBasePath('', '/audits')        → '/audits'
 */
export function joinBasePath(basePath: string | undefined, pathname: string): string {
  const base = normaliseBasePath(basePath);
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  if (!base) return path;
  if (path === '/') return base;
  return `${base}${path}`;
}

/** WHY: accepts 'my-app', '/my-app/' and '/my-app' alike; '' and '/' mean "no base path". */
export function normaliseBasePath(basePath: string | undefined): string {
  const trimmed = (basePath ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/**
 * WHY: `document.referrer` is a full URL (its path and query may contain PII). Return the HOST
 * only, and only when it is EXTERNAL — an in-app referrer is already covered by `referrerPath`.
 */
export function externalReferrerHost(referrer: string, currentHost: string): string | undefined {
  if (!referrer) return undefined;
  try {
    const url = new URL(referrer);
    if (!url.hostname || url.host === currentHost) return undefined;
    return url.hostname.slice(0, INGEST_LIMITS.maxReferrerHostLength);
  } catch {
    return undefined;
  }
}
