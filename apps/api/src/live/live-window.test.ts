import { ACTIVE_USER_WINDOW_MS } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { LatencyHistogram, LiveWindow, type LiveApiSample } from './live-window';

const T0 = new Date('2026-10-01T10:00:05.000Z');
const later = (ms: number) => new Date(T0.getTime() + ms);

function apiSample(overrides: Partial<LiveApiSample> = {}): LiveApiSample {
  return { kind: 'http', statusCode: 200, durationMs: 40, actor: 'user:a', ...overrides };
}

describe('LatencyHistogram', () => {
  it('is null when empty', () => {
    expect(new LatencyHistogram().percentile(0.95)).toBeNull();
  });

  it('reports the bucket bound of the rank, capped by the largest value seen', () => {
    const histogram = new LatencyHistogram();
    for (let i = 0; i < 95; i += 1) histogram.record(20);
    for (let i = 0; i < 5; i += 1) histogram.record(900);
    expect(histogram.percentile(0.95)).toBe(25);
    expect(histogram.percentile(0.99)).toBe(900);

    const fast = new LatencyHistogram();
    fast.record(3);
    expect(fast.percentile(0.95)).toBe(3);
  });

  it('uses the largest value for overflow beyond the last bucket', () => {
    const histogram = new LatencyHistogram();
    histogram.record(120_000);
    expect(histogram.percentile(0.95)).toBe(120_000);
  });
});

describe('LiveWindow', () => {
  it('counts the current minute per scope: all apps and the app itself', () => {
    const window = new LiveWindow();
    window.recordApiRequest('ebo-sales', apiSample({ statusCode: 200 }), T0);
    window.recordApiRequest('ebo-sales', apiSample({ statusCode: 404 }), T0);
    window.recordApiRequest('hr', apiSample({ statusCode: 503 }), T0);
    window.recordWebEvent('hr', { eventType: 'page_view', actor: 'session:s1' }, T0);
    window.recordWebEvent('hr', { eventType: 'tool_use', actor: 'session:s1' }, T0);
    window.recordWebEvent('hr', { eventType: 'page_time', actor: 'session:s1' }, T0);

    const all = window.tick('all', later(1000));
    expect(all).toMatchObject({
      scope: 'all',
      minute: '2026-10-01T10:00:00.000Z',
      requests: 3,
      errors4xx: 1,
      errors5xx: 1,
      pageViews: 1,
      toolUses: 1,
      activeUsers: 2,
    });
    expect(window.tick('app:ebo-sales', later(1000))).toMatchObject({
      scope: 'app:ebo-sales',
      requests: 2,
      errors4xx: 1,
      errors5xx: 0,
      pageViews: 0,
      activeUsers: 1,
    });
    expect(window.tick('app:other', later(1000))).toMatchObject({
      requests: 0,
      p95Ms: null,
      activeUsers: 0,
    });
  });

  it('computes p95 from http calls only (streams excluded)', () => {
    const window = new LiveWindow();
    window.recordApiRequest('ebo-sales', apiSample({ durationMs: 30 }), T0);
    window.recordApiRequest('ebo-sales', apiSample({ kind: 'stream', durationMs: 50_000 }), T0);
    expect(window.tick('all', T0).p95Ms).toBe(30);
  });

  it('starts from zero when the minute rolls over, keeping presence', () => {
    const window = new LiveWindow();
    window.recordApiRequest('ebo-sales', apiSample(), T0);
    const next = window.tick('all', new Date('2026-10-01T10:01:00.000Z'));
    expect(next).toMatchObject({
      minute: '2026-10-01T10:01:00.000Z',
      requests: 0,
      p95Ms: null,
      activeUsers: 1,
    });
  });

  it('forgets actors after ACTIVE_USER_WINDOW_MS and ignores events without an actor', () => {
    const window = new LiveWindow();
    window.recordApiRequest('ebo-sales', apiSample({ actor: null }), T0);
    window.recordApiRequest('ebo-sales', apiSample({ actor: 'user:a' }), T0);
    expect(window.tick('all', later(1000)).activeUsers).toBe(1);
    expect(window.tick('all', later(ACTIVE_USER_WINDOW_MS + 1)).activeUsers).toBe(0);
  });
});
