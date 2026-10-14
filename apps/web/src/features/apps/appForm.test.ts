import { describe, expect, it } from 'vitest';

import { ADMIN_APPS, apiKey, PUBLISHABLE_KEY } from '@/test/adminFixtures';

import {
  appFormOf,
  currentPublishableKey,
  envSnippet,
  expiresAtFor,
  keyStatusOf,
  parseOrigins,
  toCreateKeyBody,
  toUpdateAppBody,
} from './appForm';

const NOW = Date.parse('2026-10-01T10:00:00.000Z');
const APP = ADMIN_APPS[0]!;

describe('parseOrigins', () => {
  it('splits on lines, commas and spaces, trims trailing slashes and dedupes', () => {
    expect(parseOrigins(' https://a.in/, https://b.in\nhttps://a.in \n\n')).toEqual([
      'https://a.in',
      'https://b.in',
    ]);
  });
});

describe('toUpdateAppBody', () => {
  it('sends only the changed fields', () => {
    const values = { ...appFormOf(APP), displayName: 'EBO', isActive: false };
    expect(toUpdateAppBody(values, APP)).toEqual({
      ok: true,
      body: { displayName: 'EBO', isActive: false },
    });
  });

  it('returns a null body when nothing changed', () => {
    expect(toUpdateAppBody(appFormOf(APP), APP)).toEqual({ ok: true, body: null });
  });

  it('names the bad origin line', () => {
    const result = toUpdateAppBody(
      { ...appFormOf(APP), allowedOrigins: 'https://ok.in\nnot-an-origin' },
      APP,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.allowedOrigins).toMatch(/^Origin 2: /);
  });
});

describe('toCreateKeyBody', () => {
  it('requires a label (shared createKeyBodySchema)', () => {
    expect(toCreateKeyBody({ kind: 'secret', label: '  ' }).ok).toBe(false);
    expect(toCreateKeyBody({ kind: 'publishable', label: 'web' })).toEqual({
      ok: true,
      body: { kind: 'publishable', label: 'web' },
    });
  });
});

describe('key status', () => {
  it('revoked > expired > expiring > active', () => {
    expect(keyStatusOf(apiKey(), NOW)).toBe('active');
    expect(keyStatusOf(apiKey({ expiresAt: '2026-10-02T00:00:00.000Z' }), NOW)).toBe('expiring');
    expect(keyStatusOf(apiKey({ expiresAt: '2026-09-30T00:00:00.000Z' }), NOW)).toBe('expired');
    expect(
      keyStatusOf(
        apiKey({ expiresAt: '2026-10-02T00:00:00.000Z', revokedAt: '2026-10-01T00:00:00.000Z' }),
        NOW,
      ),
    ).toBe('revoked');
  });

  it('picks the newest usable publishable key', () => {
    expect(currentPublishableKey(APP, NOW)?.publicKey).toBe(PUBLISHABLE_KEY);
    const revokedOnly = {
      ...APP,
      keys: APP.keys.map((key) => ({ ...key, revokedAt: '2026-10-01T00:00:00.000Z' })),
    };
    expect(currentPublishableKey(revokedOnly, NOW)).toBeNull();
  });

  it('expiresAtFor adds the grace period', () => {
    expect(expiresAtFor('now', NOW)).toBe('2026-10-01T10:00:00.000Z');
    expect(expiresAtFor('24h', NOW)).toBe('2026-10-02T10:00:00.000Z');
  });
});

describe('envSnippet', () => {
  it('lists only the known values, one NAME=value per line, never a secret', () => {
    expect(envSnippet('https://nexus.libas.in/traffic', 'nx_pk_abc')).toBe(
      'NEXUS_URL=https://nexus.libas.in/traffic\nNEXT_PUBLIC_NEXUS_KEY=nx_pk_abc',
    );
    expect(envSnippet(null, 'nx_pk_abc')).toBe('NEXT_PUBLIC_NEXUS_KEY=nx_pk_abc');
    expect(envSnippet(null, null)).toBeNull();
  });
});
