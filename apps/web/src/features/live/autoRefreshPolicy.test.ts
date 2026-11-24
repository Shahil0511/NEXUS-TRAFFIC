import { afterEach, describe, expect, it, vi } from 'vitest';

import { qk } from '@/lib/query/keys';

import { createThrottle, isTrafficDrivenKey } from './autoRefreshPolicy';

describe('isTrafficDrivenKey', () => {
  it('refreshes every analytics group', () => {
    for (const key of [
      qk.overview.summary({ range: '24h' }),
      qk.endpoints.all,
      qk.errors.all,
      qk.users.all,
      qk.journeys.all,
      qk.pages.all,
      qk.tools.all,
      qk.geo.all,
      qk.integration.health(),
    ]) {
      expect(isTrafficDrivenKey(key)).toBe(true);
    }
  });

  it('leaves identity, the app list and the self-updating Live cache alone', () => {
    expect(isTrafficDrivenKey(qk.me.get())).toBe(false);
    expect(isTrafficDrivenKey(qk.apps.list())).toBe(false);
    expect(isTrafficDrivenKey(qk.live.snapshot({}))).toBe(false);
  });

  it('never refetches person-level reads in the background (each one is access-logged)', () => {
    const key = 'ab'.repeat(32);
    for (const personKey of [
      qk.users.profile(key, { range: '24h' }),
      qk.users.timeline(key, { range: '24h', limit: 50 }),
      qk.users.devices(key, { range: '24h' }),
      qk.users.daily(key, { range: '24h' }),
      qk.journeys.sessions({ range: '24h', limit: 50, userKey: key }),
      // A verified visit's steps are access-logged (ADR 0017); the key cannot tell, so never.
      qk.journeys.session('ebo-sales', '0b0c7f43-5a4e-4d0e-9a68-3f2a1b7c9d10', { range: '24h' }),
      qk.privacy.accessLog({ limit: 50 }),
    ]) {
      expect(isTrafficDrivenKey(personKey), String(personKey[1])).toBe(false);
    }
    // The open lists still follow the traffic.
    expect(
      isTrafficDrivenKey(qk.users.list({ range: '24h', limit: 50, sort: 'lastSeen', dir: 'desc' })),
    ).toBe(true);
    expect(isTrafficDrivenKey(qk.journeys.sessions({ range: '24h', limit: 50 }))).toBe(true);
  });
});

describe('createThrottle', () => {
  afterEach(() => vi.useRealTimers());

  it('runs the first request at once and collapses a burst into one trailing run', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const throttle = createThrottle(run, 5000);

    throttle.request();
    expect(run).toHaveBeenCalledTimes(1);

    throttle.request();
    throttle.request();
    throttle.request();
    expect(run).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(4999);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('runs immediately again once the window has passed', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const throttle = createThrottle(run, 5000);
    throttle.request();
    vi.advanceTimersByTime(6000);
    throttle.request();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('cancel drops the pending trailing run', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const throttle = createThrottle(run, 5000);
    throttle.request();
    throttle.request();
    throttle.cancel();
    vi.advanceTimersByTime(10_000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
