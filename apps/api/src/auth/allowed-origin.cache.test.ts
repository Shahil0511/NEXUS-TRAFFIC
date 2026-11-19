import { describe, expect, it, vi } from 'vitest';

import { fake } from '../../test/ingest-fixtures';
import { FixedClock } from '../lib/clock';
import type { AppRepository } from '../repositories/app.repository';
import { AllowedOriginCache, ALLOWED_ORIGIN_TTL_MS } from './allowed-origin.cache';

const NOW = new Date('2026-10-01T10:00:00.000Z');

function build(allowed: ReadonlySet<string>, maxEntries?: number) {
  const anyAllowsOrigin = vi.fn(async (origin: string) => allowed.has(origin));
  const clock = new FixedClock(NOW);
  const cache = new AllowedOriginCache(
    fake<AppRepository>({ anyAllowsOrigin }),
    clock,
    'browser-enabled',
    ALLOWED_ORIGIN_TTL_MS,
    maxEntries,
  );
  return { cache, clock, anyAllowsOrigin };
}

describe('AllowedOriginCache rules', () => {
  it('`registered` asks anyListsOrigin (killed / disabled apps count), `browser-enabled` anyAllowsOrigin', async () => {
    const anyAllowsOrigin = vi.fn(async () => false);
    const anyListsOrigin = vi.fn(async () => true);
    const apps = fake<AppRepository>({ anyAllowsOrigin, anyListsOrigin });
    const clock = new FixedClock(NOW);
    expect(await new AllowedOriginCache(apps, clock, 'registered').allows('https://killed.libas.in')).toBe(true);
    expect(anyListsOrigin).toHaveBeenCalledWith('https://killed.libas.in');
    expect(anyAllowsOrigin).not.toHaveBeenCalled();
    expect(await new AllowedOriginCache(apps, clock).allows('https://killed.libas.in')).toBe(false);
    expect(anyAllowsOrigin).toHaveBeenCalledTimes(1);
  });
});

describe('AllowedOriginCache', () => {
  it('asks the repository once per origin within the TTL (positives and negatives)', async () => {
    const { cache, anyAllowsOrigin } = build(new Set(['https://ebo.libas.in']));
    expect(await cache.allows('https://ebo.libas.in')).toBe(true);
    expect(await cache.allows('HTTPS://EBO.LIBAS.IN/')).toBe(true);
    expect(await cache.allows('https://evil.example')).toBe(false);
    expect(await cache.allows('https://evil.example')).toBe(false);
    expect(anyAllowsOrigin).toHaveBeenCalledTimes(2);
    expect(anyAllowsOrigin).toHaveBeenCalledWith('https://ebo.libas.in');
  });

  it('re-asks after the TTL', async () => {
    const { cache, clock, anyAllowsOrigin } = build(new Set());
    await cache.allows('https://a.example');
    clock.set(new Date(NOW.getTime() + ALLOWED_ORIGIN_TTL_MS));
    await cache.allows('https://a.example');
    expect(anyAllowsOrigin).toHaveBeenCalledTimes(2);
  });

  it('evicts the least recently used origin beyond maxEntries', async () => {
    const { cache, anyAllowsOrigin } = build(new Set(), 2);
    await cache.allows('https://a.example');
    await cache.allows('https://b.example');
    await cache.allows('https://a.example'); // a is now the most recent
    await cache.allows('https://c.example'); // evicts b
    expect(cache.size).toBe(2);
    await cache.allows('https://a.example');
    expect(anyAllowsOrigin).toHaveBeenCalledTimes(3);
    await cache.allows('https://b.example');
    expect(anyAllowsOrigin).toHaveBeenCalledTimes(4);
  });

  it('shares one repository query between concurrent misses for the same origin', async () => {
    const { cache, anyAllowsOrigin } = build(new Set(['https://ebo.libas.in']));
    const answers = await Promise.all([
      cache.allows('https://ebo.libas.in'),
      cache.allows('https://EBO.libas.in/'),
      cache.allows('https://ebo.libas.in'),
    ]);
    expect(answers).toEqual([true, true, true]);
    expect(anyAllowsOrigin).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed lookup: the next call asks again', async () => {
    const { cache, anyAllowsOrigin } = build(new Set(['https://ebo.libas.in']));
    anyAllowsOrigin.mockRejectedValueOnce(new Error('db down'));
    await expect(cache.allows('https://ebo.libas.in')).rejects.toThrow('db down');
    expect(await cache.allows('https://ebo.libas.in')).toBe(true);
    expect(anyAllowsOrigin).toHaveBeenCalledTimes(2);
  });
});
