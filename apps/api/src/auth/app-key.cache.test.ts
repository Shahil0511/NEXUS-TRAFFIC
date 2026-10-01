import { describe, expect, it } from 'vitest';

import { apiKeyRow, appRow, FIXED_NOW } from '../../test/ingest-fixtures';
import type { AuthenticatedKey } from '../domain/viewer';
import { FixedClock } from '../lib/clock';
import { AppKeyCache } from './app-key.cache';

function entry(appId: string, keyId: string): AuthenticatedKey {
  return { app: appRow({ id: appId }), key: apiKeyRow({ id: keyId, app_id: appId }) };
}

describe('AppKeyCache', () => {
  it('returns what was set', () => {
    const cache = new AppKeyCache(new FixedClock(FIXED_NOW));
    const value = entry('a', 'k1');
    cache.set('nx_sk_aaaaaaaa', value);
    expect(cache.get('nx_sk_aaaaaaaa')).toBe(value);
    expect(cache.get('nx_sk_bbbbbbbb')).toBeUndefined();
  });

  it('expires entries after the TTL', () => {
    const clock = new FixedClock(FIXED_NOW);
    const cache = new AppKeyCache(clock, 30_000);
    cache.set('p', entry('a', 'k1'));
    clock.set(new Date(FIXED_NOW.getTime() + 29_999));
    expect(cache.get('p')).toBeDefined();
    clock.set(new Date(FIXED_NOW.getTime() + 30_000));
    expect(cache.get('p')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('evicts the least recently used entry beyond maxEntries', () => {
    const cache = new AppKeyCache(new FixedClock(FIXED_NOW), 30_000, 2);
    cache.set('p1', entry('a', 'k1'));
    cache.set('p2', entry('a', 'k2'));
    cache.get('p1'); // p1 is now the most recent → p2 is the LRU
    cache.set('p3', entry('a', 'k3'));
    expect(cache.get('p2')).toBeUndefined();
    expect(cache.get('p1')).toBeDefined();
    expect(cache.get('p3')).toBeDefined();
    expect(cache.size).toBe(2);
  });

  it('re-setting a key refreshes it instead of duplicating it', () => {
    const cache = new AppKeyCache(new FixedClock(FIXED_NOW), 30_000, 2);
    cache.set('p1', entry('a', 'k1'));
    cache.set('p2', entry('a', 'k2'));
    cache.set('p1', entry('a', 'k1b'));
    cache.set('p3', entry('a', 'k3'));
    expect(cache.get('p1')?.key.id).toBe('k1b');
    expect(cache.get('p2')).toBeUndefined();
  });

  it('invalidateApp removes every entry of that app only', () => {
    const cache = new AppKeyCache(new FixedClock(FIXED_NOW));
    cache.set('p1', entry('a', 'k1'));
    cache.set('p2', entry('a', 'k2'));
    cache.set('p3', entry('b', 'k3'));
    cache.invalidateApp('a');
    expect(cache.get('p1')).toBeUndefined();
    expect(cache.get('p2')).toBeUndefined();
    expect(cache.get('p3')).toBeDefined();
  });
});
