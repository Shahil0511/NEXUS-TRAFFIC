/**
 * Mints a DEV `access_token` — the same HS256 JWT shape the company portal issues.
 *
 * WHY: locally there is no portal to sign in through. The launcher signs a token with the dev-only
 * LIBAS_JWT_SECRET from `.env.dev`, so the dashboard proxy and the api verify it with exactly the
 * production code path (@nexus/auth verifyAccessToken). This only works because the secret is
 * random per laptop — it can never forge a token for the real portal.
 */
import { ACCESS_TOKEN_COOKIE, DEV_ACCESS_TOKEN_TTL_SECONDS, signAccessToken, type SignedAccessToken } from '@nexus/auth';

/** 8 hours, like a working day on the portal. */
export const DEV_TOKEN_TTL_SECONDS = DEV_ACCESS_TOKEN_TTL_SECONDS;

export type MintedToken = SignedAccessToken;

/** HS256 JWT with claims { email, type: 'access', iat, exp } (@nexus/auth signAccessToken). */
export function mintAccessToken(email: string, secret: string, nowMs: number = Date.now()): MintedToken {
  return signAccessToken(email, secret, nowMs);
}

/**
 * Set-Cookie for localhost. Cookies are NOT port-scoped, so the dashboard (:3000) and the api
 * (:4000) receive a cookie set by the launcher (:3399) as long as the browser uses `localhost`.
 */
export function accessTokenSetCookie(token: string): string {
  return `${ACCESS_TOKEN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DEV_TOKEN_TTL_SECONDS}`;
}

/** Set-Cookie that deletes the token (sign out). */
export function clearAccessTokenSetCookie(): string {
  return `${ACCESS_TOKEN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
