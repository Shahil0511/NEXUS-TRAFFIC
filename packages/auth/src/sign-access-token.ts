/**
 * Signs an `access_token` with the same HS256 shape the company portal issues.
 *
 * WHY: local development has no portal. `next dev` (apps/web/src/proxy.ts, DEV_USER_EMAIL) and the
 * dev scripts sign a token with the dev-only LIBAS_JWT_SECRET, so the dashboard and the api verify
 * it with exactly the production code path (verifyAccessToken). It can never forge a token for the
 * real portal because the dev secret is random per laptop.
 *
 * NEVER call this from production code paths.
 *
 * @see ./verify-access-token.ts
 */
import { createHmac } from 'node:crypto';

/** 8 hours, like a working day on the portal. */
export const DEV_ACCESS_TOKEN_TTL_SECONDS = 8 * 60 * 60;

export interface SignedAccessToken {
  token: string;
  /** Seconds since epoch. */
  expiresAt: number;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/** HS256 JWT with claims { email, type: 'access', iat, exp }. */
export function signAccessToken(
  email: string,
  secret: string,
  nowMs: number = Date.now(),
  ttlSeconds: number = DEV_ACCESS_TOKEN_TTL_SECONDS,
): SignedAccessToken {
  if (!secret) throw new Error('signAccessToken: empty secret');
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + ttlSeconds;
  const header = base64UrlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64UrlJson({ email, type: 'access', iat, exp });
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return { token: `${header}.${payload}.${signature}`, expiresAt: exp };
}
