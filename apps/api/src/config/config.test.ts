import { describe, expect, it } from 'vitest';

import { ConfigError, parseConfig } from './index';

const HEX = 'a'.repeat(64);

/** The minimal valid environment: every required key, nothing else. */
function validEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: 'postgres://nexus_app:pw@postgres:5432/nexus',
    LIBAS_JWT_SECRET: 'portal-secret',
    API_KEY_PEPPER: HEX,
    USER_KEY_SECRET: HEX,
    IP_HASH_SECRET: HEX,
    ...overrides,
  };
}

function configErrorOf(source: NodeJS.ProcessEnv): ConfigError {
  try {
    parseConfig(source);
  } catch (err) {
    if (err instanceof ConfigError) return err;
    throw err;
  }
  throw new Error('expected parseConfig to throw');
}

describe('parseConfig', () => {
  it('accepts a valid env and applies defaults', () => {
    const config = parseConfig(validEnv());
    expect(config.env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4000,
      LOG_LEVEL: 'info',
      PG_POOL_WRITE_MAX: 4,
      IP_STORAGE_MODE: 'full',
      RAW_RETENTION_MONTHS: 6,
    });
    expect(config.isProduction).toBe(false);
    expect(config.accessPolicy).toEqual({
      allowedEmails: [],
      allowedDomains: ['libas.in'],
      adminEmails: [],
    });
    expect(config.corsDevOrigins).toEqual([]);
    expect(typeof config.docsDir).toBe('string');
  });

  it('coerces numbers and detects production', () => {
    const config = parseConfig(
      validEnv({ NODE_ENV: 'production', PORT: '8080', DOCS_DIR: '/srv/docs' }),
    );
    expect(config.env.PORT).toBe(8080);
    expect(config.isProduction).toBe(true);
    expect(config.docsDir).toBe('/srv/docs');
  });

  it('lists EVERY missing/invalid key in ONE message', () => {
    const err = configErrorOf({ API_KEY_PEPPER: 'short' });
    expect(err.message.split('\n')).toHaveLength(1);
    for (const key of [
      'DATABASE_URL',
      'LIBAS_JWT_SECRET',
      'API_KEY_PEPPER',
      'USER_KEY_SECRET',
      'IP_HASH_SECRET',
    ]) {
      expect(err.message).toContain(key);
    }
    expect(err.message).toContain('openssl rand -hex 32');
    expect(err.message).not.toContain('short');
  });

  it('parses comma/space separated lists, lower-cased', () => {
    const config = parseConfig(
      validEnv({
        DASHBOARD_ALLOWED_EMAILS: ' A@Libas.in, b@libas.in  c@libas.in ',
        DASHBOARD_ALLOWED_DOMAINS: 'libas.in,Example.com',
        DASHBOARD_ADMIN_EMAILS: 'Boss@libas.in',
        CORS_DEV_ORIGINS: 'http://localhost:3000, http://localhost:3305',
      }),
    );
    expect(config.accessPolicy).toEqual({
      allowedEmails: ['a@libas.in', 'b@libas.in', 'c@libas.in'],
      allowedDomains: ['libas.in', 'example.com'],
      adminEmails: ['boss@libas.in'],
    });
    expect(config.corsDevOrigins).toEqual(['http://localhost:3000', 'http://localhost:3305']);
  });

  it('strips unknown keys and freezes the result', () => {
    const config = parseConfig(validEnv({ NEXT_PUBLIC_SOCKET_PATH: '/traffic/socket.io' }));
    expect(config.env).not.toHaveProperty('NEXT_PUBLIC_SOCKET_PATH');
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.accessPolicy)).toBe(true);
  });
});
