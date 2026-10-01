/**
 * Convenience: read the `access_token` cookie from a raw Cookie header and verify it.
 * Used by the API's SSO middleware, the Socket.io handshake and the browser-ingest identity resolver.
 */
import { readCookie } from './read-cookie';
import { ACCESS_TOKEN_COOKIE, verifyAccessToken, type VerifyResult } from './verify-access-token';

export type CookieVerifyResult = VerifyResult | { ok: false; reason: 'no-cookie' };

export function verifyAccessTokenCookie(
  cookieHeader: string | undefined | null,
  secret: string | undefined,
  nowMs: number = Date.now(),
): CookieVerifyResult {
  const token = readCookie(cookieHeader, ACCESS_TOKEN_COOKIE);
  if (!token) return { ok: false, reason: 'no-cookie' };
  return verifyAccessToken(token, secret, nowMs);
}
