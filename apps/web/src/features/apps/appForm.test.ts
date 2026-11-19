import { describe, expect, it } from 'vitest';

import { ADMIN_APPS, apiKey, PUBLISHABLE_KEY, sdkConfig } from '@/test/adminFixtures';

import {
  appFormOf,
  currentPublishableKey,
  envSnippet,
  expiresAtFor,
  keyStatusOf,
  parseOrigins,
  sdkConfigFormOf,
  sdkConfigSummary,
  toCreateKeyBody,
  toKillSwitchBody,
  toUpdateAppBody,
  toUpdateSdkConfigBody,
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

describe('remote SDK config form', () => {
  it('starts from the app: unchecked = disabled remotely, kill switch = browser ingest off', () => {
    const values = sdkConfigFormOf(APP);
    expect(values.killSwitch).toBe(false);
    expect(values.enabledModules).not.toContain('auto_tools');
    expect(values.enabledModules).toHaveLength(6);
    expect(sdkConfigFormOf({ ...APP, browserIngestEnabled: false }).killSwitch).toBe(true);
  });

  it('sends the FULL disabled list (stable order) with the version the admin saw', () => {
    const values = sdkConfigFormOf(APP);
    const next = {
      ...values,
      enabledModules: values.enabledModules.filter((module) => module !== 'retry_queue'),
    };
    expect(toUpdateSdkConfigBody(next, APP)).toEqual({
      ok: true,
      body: { expectedVersion: 3, disabledModules: ['auto_tools', 'retry_queue'] },
    });
  });

  it('returns a null body when the modules did not change', () => {
    expect(toUpdateSdkConfigBody(sdkConfigFormOf(APP), APP)).toEqual({ ok: true, body: null });
    // Order of the stored list does not matter.
    const unordered = {
      ...APP,
      sdkConfig: sdkConfig({ version: 2, disabledModules: ['retry_queue', 'page_view'] }),
    };
    expect(toUpdateSdkConfigBody(sdkConfigFormOf(unordered), unordered).ok).toBe(true);
    expect(toUpdateSdkConfigBody(sdkConfigFormOf(unordered), unordered)).toEqual({
      ok: true,
      body: null,
    });
  });

  it('turns the kill switch into the browserIngestEnabled update (null when unchanged)', () => {
    const values = sdkConfigFormOf(APP);
    expect(toKillSwitchBody(values, APP)).toBeNull();
    expect(toKillSwitchBody({ ...values, killSwitch: true }, APP)).toEqual({
      browserIngestEnabled: false,
    });
  });

  it('summarises the config for the Apps card', () => {
    expect(sdkConfigSummary(APP)).toBe('1 off: Automatic tool clicks');
    expect(sdkConfigSummary({ ...APP, sdkConfig: sdkConfig() })).toBe('All modules on');
    expect(sdkConfigSummary({ ...APP, browserIngestEnabled: false })).toMatch(/^Kill switch on/);
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
