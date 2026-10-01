import { describe, expect, it } from 'vitest';

import { appRoleOf, MigrateConfigError, parseMigrateConfig } from './migrate-config';

const valid = {
  MIGRATION_DATABASE_URL: 'postgres://owner:pw@postgres:5432/nexus_traffic',
  NEXUS_APP_DB_PASSWORD: 'a'.repeat(32),
};

/** The one-line error message of a failing parse ('' when it did not fail). */
function errorOf(source: NodeJS.ProcessEnv): string {
  try {
    parseMigrateConfig(source);
  } catch (err) {
    expect(err).toBeInstanceOf(MigrateConfigError);
    return (err as Error).message;
  }
  return '';
}

describe('parseMigrateConfig', () => {
  it('accepts the two required keys and defaults DB_APP_ROLE_MODE=separate and LOG_LEVEL', () => {
    expect(parseMigrateConfig(valid)).toEqual({ ...valid, DB_APP_ROLE_MODE: 'separate', LOG_LEVEL: 'info' });
  });

  it('lists every problem on one line without echoing values', () => {
    const secret = 'short-secret';
    const message = errorOf({ NEXUS_APP_DB_PASSWORD: secret });
    expect(message).toContain('MIGRATION_DATABASE_URL');
    expect(message).toContain('NEXUS_APP_DB_PASSWORD');
    expect(message).not.toContain(secret);
    expect(message).not.toContain('\n');
  });

  it('separate mode requires a password of at least 16 characters', () => {
    expect(() => parseMigrateConfig({ ...valid, NEXUS_APP_DB_PASSWORD: 'x'.repeat(15) })).toThrow(/at least 16/);
  });

  it.each([
    ['missing', undefined],
    ['empty (compose ${NEXUS_APP_DB_PASSWORD:-})', ''],
  ])('separate mode rejects a %s password and names the key', (_label, password) => {
    const message = errorOf({
      MIGRATION_DATABASE_URL: valid.MIGRATION_DATABASE_URL,
      DB_APP_ROLE_MODE: 'separate',
      NEXUS_APP_DB_PASSWORD: password,
    });
    expect(message).toMatch(/NEXUS_APP_DB_PASSWORD: required when DB_APP_ROLE_MODE=separate/);
  });

  it.each([undefined, ''])('owner mode needs no password (%j)', (password) => {
    const config = parseMigrateConfig({
      MIGRATION_DATABASE_URL: valid.MIGRATION_DATABASE_URL,
      DB_APP_ROLE_MODE: 'owner',
      NEXUS_APP_DB_PASSWORD: password,
    });
    expect(config.DB_APP_ROLE_MODE).toBe('owner');
  });

  it('rejects an unknown DB_APP_ROLE_MODE', () => {
    expect(errorOf({ ...valid, DB_APP_ROLE_MODE: 'shared' })).toContain('DB_APP_ROLE_MODE');
  });
});

describe('appRoleOf', () => {
  it('separate mode carries the password', () => {
    expect(appRoleOf(parseMigrateConfig(valid))).toEqual({ mode: 'separate', password: valid.NEXUS_APP_DB_PASSWORD });
  });

  it('owner mode carries no password even when one is set', () => {
    expect(appRoleOf(parseMigrateConfig({ ...valid, DB_APP_ROLE_MODE: 'owner' }))).toEqual({ mode: 'owner' });
  });
});
