import { verifyAccessToken } from '@nexus/auth';
import { describe, expect, it } from 'vitest';

import { accessTokenSetCookie, DEV_TOKEN_TTL_SECONDS, mintAccessToken } from './token';

const SECRET = 'b'.repeat(64);
const NOW = Date.UTC(2026, 9, 1, 10, 0, 0);

describe('mintAccessToken', () => {
  it('produces a token the production verifier accepts', () => {
    const { token, expiresAt } = mintAccessToken('Admin@Libas.in', SECRET, NOW);
    const result = verifyAccessToken(token, SECRET, NOW + 1000);
    expect(result).toMatchObject({ ok: true, email: 'admin@libas.in', typeMissing: false });
    expect(expiresAt).toBe(Math.floor(NOW / 1000) + DEV_TOKEN_TTL_SECONDS);
  });

  it('pins HS256 and the access type', () => {
    const { token } = mintAccessToken('viewer@libas.in', SECRET, NOW);
    const [header, payload] = token.split('.') as [string, string, string];
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toMatchObject({
      email: 'viewer@libas.in',
      type: 'access',
      iat: Math.floor(NOW / 1000),
    });
  });

  it('is rejected with another secret and after 8 hours', () => {
    const { token } = mintAccessToken('admin@libas.in', SECRET, NOW);
    expect(verifyAccessToken(token, 'c'.repeat(64), NOW)).toEqual({ ok: false, reason: 'bad-signature' });
    expect(verifyAccessToken(token, SECRET, NOW + DEV_TOKEN_TTL_SECONDS * 1000 + 1)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('builds an HttpOnly, SameSite=Lax cookie on path /', () => {
    expect(accessTokenSetCookie('t.o.k')).toBe(
      `access_token=t.o.k; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DEV_TOKEN_TTL_SECONDS}`,
    );
  });
});
