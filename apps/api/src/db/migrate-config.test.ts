import { describe, expect, it } from 'vitest';

import { MigrateConfigError, parseMigrateConfig } from './migrate-config';

const valid = {
  MIGRATION_DATABASE_URL: 'postgres://owner:pw@postgres:5432/nexus_traffic',
  NEXUS_APP_DB_PASSWORD: 'a'.repeat(32),
};

describe('parseMigrateConfig', () => {
  it('accepts the two required keys and defaults LOG_LEVEL', () => {
    expect(parseMigrateConfig(valid)).toEqual({ ...valid, LOG_LEVEL: 'info' });
  });

  it('lists every problem on one line without echoing values', () => {
    const secret = 'short-secret';
    let message = '';
    try {
      parseMigrateConfig({ NEXUS_APP_DB_PASSWORD: secret });
    } catch (err) {
      expect(err).toBeInstanceOf(MigrateConfigError);
      message = (err as Error).message;
    }
    expect(message).toContain('MIGRATION_DATABASE_URL');
    expect(message).toContain('NEXUS_APP_DB_PASSWORD');
    expect(message).not.toContain(secret);
    expect(message).not.toContain('\n');
  });

  it('requires a password of at least 16 characters', () => {
    expect(() => parseMigrateConfig({ ...valid, NEXUS_APP_DB_PASSWORD: 'x'.repeat(15) })).toThrow(/at least 16/);
  });
});
