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
