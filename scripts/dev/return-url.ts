/**
 * Validates the `return` query parameter of the launcher's sign-in.
 *
 * WHY: the dashboard sends signed-out users to `http://localhost:3399/?return=<dashboard URL>`.
 * Redirecting to whatever that parameter says would make the launcher an open redirect, so ONLY
 * plain http URLs on localhost / 127.0.0.1 are followed; anything else falls back to the dashboard.
 */

const ALLOWED_HOSTNAMES = new Set(['localhost', '127.0.0.1']);

/** `candidate` when it is an http://localhost or http://127.0.0.1 URL (any port), else `fallback`. */
export function safeReturnUrl(candidate: string | null | undefined, fallback: string): string {
  if (!candidate) return fallback;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return fallback;
  }
  if (url.protocol !== 'http:') return fallback;
  if (!ALLOWED_HOSTNAMES.has(url.hostname)) return fallback;
  if (url.username || url.password) return fallback;
  return url.href;
}
