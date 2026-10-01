import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { decideDashboardAccess, parseList } from './dashboard-access';
import { extractEmail, plausibleEmail } from './plausible-email';
import { readCookie } from './read-cookie';
import { verifyAccessToken } from './verify-access-token';
import { verifyAccessTokenCookie } from './verify-access-token-cookie';

const SECRET = 'test-secret-not-prod';
const NOW = Date.UTC(2026, 9, 1, 10, 0, 0);

function sign(payload: Record<string, unknown>, secret = SECRET, alg = 'HS256'): string {
  const header = Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

const valid = { email: 'Someone@Libas.in', type: 'access', exp: NOW / 1000 + 3600 };

describe('verifyAccessToken', () => {
  it('accepts a valid token and normalizes the email', () => {
    const r = verifyAccessToken(sign(valid), SECRET, NOW);
    expect(r).toMatchObject({ ok: true, email: 'someone@libas.in', typeMissing: false });
  });

  it('rejects wrong secret, expired, wrong type, alg none, malformed', () => {
    expect(verifyAccessToken(sign(valid, 'other'), SECRET, NOW)).toEqual({ ok: false, reason: 'bad-signature' });
    expect(verifyAccessToken(sign({ ...valid, exp: NOW / 1000 - 1 }), SECRET, NOW)).toEqual({ ok: false, reason: 'expired' });
    expect(verifyAccessToken(sign({ ...valid, type: 'refresh' }), SECRET, NOW)).toEqual({ ok: false, reason: 'wrong-type' });
    expect(verifyAccessToken(sign(valid, SECRET, 'none'), SECRET, NOW)).toEqual({ ok: false, reason: 'bad-alg' });
    expect(verifyAccessToken('a.b', SECRET, NOW)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyAccessToken(sign(valid), undefined, NOW)).toEqual({ ok: false, reason: 'no-secret' });
  });

  it('honours nbf with leeway and flags a missing type', () => {
    expect(verifyAccessToken(sign({ ...valid, nbf: NOW / 1000 + 120 }), SECRET, NOW)).toEqual({ ok: false, reason: 'not-yet-valid' });
    expect(verifyAccessToken(sign({ ...valid, nbf: NOW / 1000 + 10 }), SECRET, NOW).ok).toBe(true);
    const { type: _t, ...noType } = valid;
    expect(verifyAccessToken(sign(noType), SECRET, NOW)).toMatchObject({ ok: true, typeMissing: true });
  });

  it('requires a usable email claim', () => {
    expect(verifyAccessToken(sign({ ...valid, email: 'not-an-email' }), SECRET, NOW)).toEqual({ ok: false, reason: 'no-email' });
  });
});

describe('cookies and emails', () => {
  it('reads the access_token cookie from a raw header', () => {
    expect(readCookie('a=1; access_token=abc%2Edef; b=2', 'access_token')).toBe('abc.def');
    expect(readCookie(undefined, 'access_token')).toBeNull();
    expect(verifyAccessTokenCookie('x=1', SECRET, NOW)).toEqual({ ok: false, reason: 'no-cookie' });
    expect(verifyAccessTokenCookie(`access_token=${sign(valid)}`, SECRET, NOW).ok).toBe(true);
  });

  it('plausibleEmail / extractEmail', () => {
    expect(plausibleEmail(' A@B.co ')).toBe('a@b.co');
    expect(plausibleEmail('a@b')).toBeNull();
    expect(extractEmail({ preferred_username: 'x@libas.in' })).toBe('x@libas.in');
  });
});

describe('decideDashboardAccess', () => {
  const policy = { allowedEmails: [], allowedDomains: ['libas.in'], adminEmails: ['boss@libas.in'] };

  it('admins are always allowed', () => {
    expect(decideDashboardAccess('Boss@libas.in', { ...policy, allowedEmails: ['x@y.z'] })).toEqual({ allowed: true, isAdmin: true });
  });

  it('explicit email allowlist wins over domains (fail-closed)', () => {
    const strict = { ...policy, allowedEmails: ['a@libas.in'] };
    expect(decideDashboardAccess('a@libas.in', strict).allowed).toBe(true);
    expect(decideDashboardAccess('b@libas.in', strict).allowed).toBe(false);
  });

  it('falls back to domains when no emails are listed', () => {
    expect(decideDashboardAccess('b@libas.in', policy).allowed).toBe(true);
    expect(decideDashboardAccess('b@gmail.com', policy).allowed).toBe(false);
  });

  it('parseList splits commas and spaces', () => {
    expect(parseList(' A@x.in, b@x.in  c@x.in')).toEqual(['a@x.in', 'b@x.in', 'c@x.in']);
    expect(parseList(undefined)).toEqual([]);
  });
});
