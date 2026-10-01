import { ERROR_CODES, type ErrorCode } from '@nexus/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiKeyRow, appRow, fake, FIXED_NOW, silentLogger } from '../../test/ingest-fixtures';
import type { ApiKeyRow, AppRow } from '../domain/rows';
import { AppError } from '../errors/app-error';
import { FixedClock } from '../lib/clock';
import type { ApiKeyRepository } from '../repositories/api-key.repository';
import type { AppRepository } from '../repositories/app.repository';
import { ApiKeyHasher } from './api-key.hasher';
import { AppKeyAuthenticator } from './app-key.authenticator';
import { AppKeyCache } from './app-key.cache';

const SECRET = `nx_sk_${'S3cr3t'.repeat(6)}abcd`;
const PUBLISHABLE = `nx_pk_${'Pub1'.repeat(8)}`;

class FakeApiKeys implements Pick<ApiKeyRepository, 'findByPrefix' | 'markExposed' | 'touchUsage'> {
  rows = new Map<string, ApiKeyRow>();
  findByPrefix = vi.fn(async (prefix: string) => this.rows.get(prefix) ?? null);
  markExposed = vi.fn(async (_id: string) => undefined);
  touchUsage = vi.fn(async (_id: string, _sdk: string | null) => undefined);
}

class FakeApps implements Pick<AppRepository, 'findById'> {
  rows = new Map<string, AppRow>();
  findById = vi.fn(async (id: string) => this.rows.get(id) ?? null);
}

async function failureOf(promise: Promise<unknown>): Promise<{ status: number; code: ErrorCode; message: string }> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AppError) return { status: err.statusCode, code: err.code, message: err.message };
    throw err;
  }
  throw new Error('expected a rejection');
}

describe('AppKeyAuthenticator', () => {
  const hasher = new ApiKeyHasher('p'.repeat(64));
  let clock: FixedClock;
  let apiKeys: FakeApiKeys;
  let apps: FakeApps;
  let cache: AppKeyCache;
  let authenticator: AppKeyAuthenticator;
  const app = appRow();

  function storeKey(raw: string, overrides: Partial<ApiKeyRow> = {}): ApiKeyRow {
    const row = apiKeyRow({
      key_prefix: raw.slice(0, 14),
      key_hash: hasher.hash(raw),
      kind: raw.startsWith('nx_sk_') ? 'secret' : 'publishable',
      app_id: app.id,
      ...overrides,
    });
    apiKeys.rows.set(row.key_prefix, row);
    return row;
  }

  beforeEach(() => {
    clock = new FixedClock(FIXED_NOW);
    apiKeys = new FakeApiKeys();
    apps = new FakeApps();
    apps.rows.set(app.id, app);
    cache = new AppKeyCache(clock);
    authenticator = new AppKeyAuthenticator(
      fake<ApiKeyRepository>(apiKeys),
      fake<AppRepository>(apps),
      hasher,
      cache,
      clock,
      silentLogger(),
    );
  });

  it('authenticates a valid secret key and records usage with the sdk', async () => {
    const key = storeKey(SECRET);
    const result = await authenticator.authenticate(SECRET, 'secret', '@nexus/express@1.0.0');
    expect(result).toEqual({ app, key });
    expect(apiKeys.touchUsage).toHaveBeenCalledWith(key.id, '@nexus/express@1.0.0');
  });

  it('accepts either kind for "any"', async () => {
    storeKey(PUBLISHABLE);
    await expect(authenticator.authenticate(PUBLISHABLE, 'any')).resolves.toMatchObject({ app });
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
  ])('missing key (%s) → 401 MISSING_API_KEY', async (_label, raw) => {
    expect(await failureOf(authenticator.authenticate(raw, 'secret'))).toMatchObject({
      status: 401,
      code: ERROR_CODES.MISSING_API_KEY,
    });
  });

  it('all invalid-key causes share one status, code and message', async () => {
    storeKey(SECRET.replace('S3', 'X9'), { revoked_at: FIXED_NOW });
    storeKey(`nx_sk_${'E'.repeat(40)}`, { expires_at: FIXED_NOW });
    const wrongHash = `nx_sk_${'W'.repeat(40)}`;
    storeKey(wrongHash, { key_hash: hasher.hash('something else') });
    const causes = [
      'not-a-key',
      `nx_sk_${'U'.repeat(40)}`, // unknown prefix
      wrongHash,
      SECRET.replace('S3', 'X9'), // revoked
      `nx_sk_${'E'.repeat(40)}`, // expires_at == now
    ];
    for (const raw of causes) {
      expect(await failureOf(authenticator.authenticate(raw, 'secret'))).toEqual({
        status: 401,
        code: ERROR_CODES.INVALID_API_KEY,
        message: 'Invalid API key',
      });
    }
    expect(apiKeys.touchUsage).not.toHaveBeenCalled();
  });

  it('accepts a key whose expiry is still in the future', async () => {
    storeKey(SECRET, { expires_at: new Date(FIXED_NOW.getTime() + 1) });
    await expect(authenticator.authenticate(SECRET, 'secret')).resolves.toBeDefined();
  });

  it('publishable key on a secret endpoint → 403 WRONG_KEY_TYPE', async () => {
    storeKey(PUBLISHABLE);
    expect(await failureOf(authenticator.authenticate(PUBLISHABLE, 'secret'))).toMatchObject({
      status: 403,
      code: ERROR_CODES.WRONG_KEY_TYPE,
    });
    expect(apiKeys.markExposed).not.toHaveBeenCalled();
  });

  it('secret key on a publishable endpoint → marks it exposed and 403 SECRET_KEY_EXPOSED', async () => {
    const key = storeKey(SECRET);
    expect(await failureOf(authenticator.authenticate(SECRET, 'publishable'))).toMatchObject({
      status: 403,
      code: ERROR_CODES.SECRET_KEY_EXPOSED,
    });
    expect(apiKeys.markExposed).toHaveBeenCalledWith(key.id);
  });

  it('a revoked secret key on a publishable endpoint stays INVALID_API_KEY (not exposed)', async () => {
    storeKey(SECRET, { revoked_at: FIXED_NOW });
    expect((await failureOf(authenticator.authenticate(SECRET, 'publishable'))).code).toBe(ERROR_CODES.INVALID_API_KEY);
    expect(apiKeys.markExposed).not.toHaveBeenCalled();
  });

  it('missing app → 401 INVALID_API_KEY', async () => {
    storeKey(SECRET, { app_id: '99999999-9999-4999-8999-999999999999' });
    expect((await failureOf(authenticator.authenticate(SECRET, 'secret'))).code).toBe(ERROR_CODES.INVALID_API_KEY);
  });

  it('disabled app → 403 APP_DISABLED and nothing is cached', async () => {
    apps.rows.set(app.id, appRow({ is_active: false }));
    storeKey(SECRET);
    expect(await failureOf(authenticator.authenticate(SECRET, 'secret'))).toMatchObject({
      status: 403,
      code: ERROR_CODES.APP_DISABLED,
    });
    expect(cache.size).toBe(0);
  });

  it('serves repeat requests from the cache', async () => {
    storeKey(SECRET);
    await authenticator.authenticate(SECRET, 'secret');
    await authenticator.authenticate(SECRET, 'secret');
    expect(apiKeys.findByPrefix).toHaveBeenCalledTimes(1);
    expect(apps.findById).toHaveBeenCalledTimes(1);
  });

  it('a cache hit still requires the full key (the prefix alone is public)', async () => {
    storeKey(SECRET);
    await authenticator.authenticate(SECRET, 'secret');
    const samePrefixOtherKey = SECRET.slice(0, 14) + 'Z'.repeat(SECRET.length - 14);
    expect((await failureOf(authenticator.authenticate(samePrefixOtherKey, 'secret'))).code).toBe(
      ERROR_CODES.INVALID_API_KEY,
    );
  });

  it('re-checks expiry on a cache hit', async () => {
    storeKey(SECRET, { expires_at: new Date(FIXED_NOW.getTime() + 10_000) });
    await authenticator.authenticate(SECRET, 'secret');
    clock.set(new Date(FIXED_NOW.getTime() + 10_000));
    expect((await failureOf(authenticator.authenticate(SECRET, 'secret'))).code).toBe(ERROR_CODES.INVALID_API_KEY);
    expect(apiKeys.findByPrefix).toHaveBeenCalledTimes(1);
  });

  it('kind is checked on cache hits too', async () => {
    storeKey(SECRET);
    await authenticator.authenticate(SECRET, 'secret');
    expect((await failureOf(authenticator.authenticate(SECRET, 'publishable'))).code).toBe(
      ERROR_CODES.SECRET_KEY_EXPOSED,
    );
  });

  it('a failing usage update is logged and never fails authentication', async () => {
    storeKey(SECRET);
    apiKeys.touchUsage.mockRejectedValueOnce(new Error('db down'));
    const logger = silentLogger();
    const warn = vi.spyOn(logger, 'warn');
    const withLogger = new AppKeyAuthenticator(
      fake<ApiKeyRepository>(apiKeys),
      fake<AppRepository>(apps),
      hasher,
      cache,
      clock,
      logger,
    );
    await expect(withLogger.authenticate(SECRET, 'secret')).resolves.toBeDefined();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
  });

  it('truncates an over-long sdk label before storing it', async () => {
    storeKey(SECRET);
    await authenticator.authenticate(SECRET, 'secret', 'x'.repeat(500));
    expect(apiKeys.touchUsage.mock.calls[0]?.[1]).toHaveLength(64);
  });
});
