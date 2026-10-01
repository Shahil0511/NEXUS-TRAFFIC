/**
 * Verify the portal's HS256 `access_token` JWT.
 *
 * WHY HAND-ROLLED: this is the whole of HS256 verification, it runs on every dashboard request and
 * every browser beacon, and the team's existing proxies (EBO_SALES, stockapp) do exactly this with
 * node:crypto. The signature comparison is timing-safe, the algorithm is pinned (never trust the
 * token's own `alg` — "none" would let anyone in), and nothing throws: a malformed cookie yields a
 * typed failure reason instead of a 500.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { extractEmail } from './plausible-email';

export const ACCESS_TOKEN_COOKIE = 'access_token';

/** Leeway for `nbf` (clock drift between the portal and us). */
const NBF_LEEWAY_SECONDS = 30;

export type VerifyFailureReason =
  | 'no-secret'
  | 'malformed'
  | 'bad-alg'
  | 'bad-signature'
  | 'expired'
  | 'not-yet-valid'
  | 'wrong-type'
  | 'no-email';

export type VerifyResult =
  | {
      ok: true;
      email: string;
      claims: Record<string, unknown>;
      /** Seconds since epoch. */
      expiresAt: number;
      /** True when the token had no `type` claim (accepted, but counted — see ai-context). */
      typeMissing: boolean;
    }
  | { ok: false; reason: VerifyFailureReason };

function decodeJson(segment: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function signatureMatches(signingInput: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(signingInput).digest();
  const actual = Buffer.from(signature, 'base64url');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function verifyAccessToken(
  token: string,
  secret: string | undefined,
  nowMs: number = Date.now(),
): VerifyResult {
  if (!secret) return { ok: false, reason: 'no-secret' };

  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];

  const header = decodeJson(encodedHeader);
  const claims = decodeJson(encodedPayload);
  if (!header || !claims) return { ok: false, reason: 'malformed' };
  if (header.alg !== 'HS256') return { ok: false, reason: 'bad-alg' };

  if (!signatureMatches(`${encodedHeader}.${encodedPayload}`, encodedSignature, secret)) {
    return { ok: false, reason: 'bad-signature' };
  }

  const nowSeconds = nowMs / 1000;
  const exp = claims.exp;
  if (typeof exp !== 'number' || exp <= nowSeconds) return { ok: false, reason: 'expired' };
  const nbf = claims.nbf;
  if (typeof nbf === 'number' && nbf > nowSeconds + NBF_LEEWAY_SECONDS) {
    return { ok: false, reason: 'not-yet-valid' };
  }
  if (claims.type !== undefined && claims.type !== 'access') return { ok: false, reason: 'wrong-type' };

  const email = extractEmail(claims);
  if (!email) return { ok: false, reason: 'no-email' };

  return { ok: true, email, claims, expiresAt: exp, typeMissing: claims.type === undefined };
}
