/**
 * Mints a DEV `access_token` — the same HS256 JWT shape the company portal issues.
 *
 * WHY: locally there is no portal to sign in through. The launcher signs a token with the dev-only
 * LIBAS_JWT_SECRET from `.env.dev`, so the dashboard proxy and the api verify it with exactly the
 * production code path (@nexus/auth verifyAccessToken). This only works because the secret is
 * random per laptop — it can never forge a token for the real portal.
 */
import { createHmac } from 'node:crypto';

import { ACCESS_TOKEN_COOKIE } from '@nexus/auth';

/** 8 hours, like a working day on the portal. */
export const DEV_TOKEN_TTL_SECONDS = 8 * 60 * 60;

export interface MintedToken {
  token: string;
  /** Seconds since epoch. */
  expiresAt: number;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/** HS256 JWT with claims { email, type: 'access', iat, exp }. */
export function mintAccessToken(email: string, secret: string, nowMs: number = Date.now()): MintedToken {
  if (!secret) throw new Error('mintAccessToken: empty secret');
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + DEV_TOKEN_TTL_SECONDS;
  const header = base64UrlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64UrlJson({ email, type: 'access', iat, exp });
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return { token: `${header}.${payload}.${signature}`, expiresAt: exp };
}

/**
 * Set-Cookie for localhost. Cookies are NOT port-scoped, so the dashboard (:3305) and the api
 * (:4000) receive a cookie set by the launcher (:3399) as long as the browser uses `localhost`.
 */
export function accessTokenSetCookie(token: string): string {
  return `${ACCESS_TOKEN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DEV_TOKEN_TTL_SECONDS}`;
}

/** Set-Cookie that deletes the token (sign out). */
export function clearAccessTokenSetCookie(): string {
  return `${ACCESS_TOKEN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
