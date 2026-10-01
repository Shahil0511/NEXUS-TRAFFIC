import { describe, expect, it } from 'vitest';

import { devAdminEmails } from './child-env';
import { parseDevArgs } from './cli-args';
import { isStoredKeyActive } from './seed';

describe('parseDevArgs', () => {
  it('defaults', () => {
    expect(parseDevArgs([])).toEqual({ open: true, web: true, launcherPort: 3399, yes: false, help: false });
  });

  it('reads every flag', () => {
    expect(parseDevArgs(['--no-open', '--no-web', '--port', '3400', '--yes'])).toMatchObject({
      open: false,
      web: false,
      launcherPort: 3400,
      yes: true,
    });
    expect(parseDevArgs(['--port=3500']).launcherPort).toBe(3500);
  });

  it('rejects typos and bad ports', () => {
    expect(() => parseDevArgs(['--no-opne'])).toThrow(/unknown option/);
    expect(() => parseDevArgs(['--port', 'abc'])).toThrow(/--port/);
    expect(() => parseDevArgs(['--port', '80'])).toThrow(/--port/);
  });
});

describe('devAdminEmails', () => {
  it('adds a company git email only', () => {
    expect(devAdminEmails(null)).toEqual(['admin@libas.in']);
    expect(devAdminEmails(' Dev.Person@Libas.in ')).toEqual(['admin@libas.in', 'dev.person@libas.in']);
    expect(devAdminEmails('me@gmail.com')).toEqual(['admin@libas.in']);
  });
});

describe('isStoredKeyActive', () => {
  const key = (over: Partial<Parameters<typeof isStoredKeyActive>[0][number]> = {}) => ({
    id: '00000000-0000-4000-8000-000000000000',
    kind: 'secret' as const,
    keyPrefix: 'nx_sk_ABCDEFGH',
    label: 'x',
    publicKey: null,
    createdAt: '2026-10-01T00:00:00Z',
    createdBy: 'admin@libas.in',
    expiresAt: null,
    lastUsedAt: null,
    lastSdk: null,
    exposedAt: null,
    revokedAt: null,
    ...over,
  });
  const stored = `nx_sk_ABCDEFGH${'x'.repeat(32)}`;

  it('matches an active key by prefix and kind', () => {
    expect(isStoredKeyActive([key()], stored, 'secret')).toBe(true);
    expect(isStoredKeyActive([key()], stored, 'publishable')).toBe(false);
    expect(isStoredKeyActive([key()], undefined, 'secret')).toBe(false);
  });

  it('ignores revoked and expired keys', () => {
    expect(isStoredKeyActive([key({ revokedAt: '2026-10-01T00:00:00Z' })], stored, 'secret')).toBe(false);
    expect(isStoredKeyActive([key({ expiresAt: '2000-01-01T00:00:00Z' })], stored, 'secret')).toBe(false);
  });
});
