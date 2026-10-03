import {
  CLOCK_SKEW_WARN_MS,
  INTEGRATION_STALE_AFTER_MS,
  PRIVATE_IP_MIN_EVENTS,
  type IngestCounterDto,
  type SdkHealthDto,
} from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import {
  countersBySource,
  integrationStatusOf,
  integrationWarningsOf,
  privateIpRatioOf,
  type WarningInputs,
} from './integration-health';
import type { SdkHealthRow } from './rows';

const NOW = new Date('2026-10-01T10:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

function sdkRow(overrides: Partial<SdkHealthRow> = {}): SdkHealthRow {
  return {
    app_id: 'a',
    source: 'server',
    sdk: '@nexus/express@1.0.0',
    events: 100,
    last_seen_at: NOW,
    median_skew_ms: 40,
    max_abs_skew_ms: 900,
    private_ip_events: 0,
    classified_ip_events: 100,
    ...overrides,
  };
}

function counter(overrides: Partial<IngestCounterDto> = {}): IngestCounterDto {
  return { source: 'server', accepted: 10, duplicates: 0, rejected: 0, rateLimited: 0, ...overrides };
}

function sdkDto(medianClockSkewMs: number | null): SdkHealthDto {
  return {
    source: 'server',
    sdk: 'x@1',
    events: 1,
    lastSeenAt: NOW.toISOString(),
    medianClockSkewMs,
    maxAbsClockSkewMs: null,
  };
}

const HEALTHY: WarningInputs = {
  isActive: true,
  status: 'healthy',
  exposedKeys: 0,
  privateIpRatio: 0.1,
  sdks: [sdkDto(40)],
  counters: [counter()],
};

describe('integrationStatusOf', () => {
  it('is never without any event, healthy within the stale threshold, stale beyond it', () => {
    expect(integrationStatusOf(null, null, NOW)).toBe('never');
    expect(integrationStatusOf(ago(1000), null, NOW)).toBe('healthy');
    expect(integrationStatusOf(null, ago(INTEGRATION_STALE_AFTER_MS), NOW)).toBe('healthy');
    expect(integrationStatusOf(ago(INTEGRATION_STALE_AFTER_MS + 1), null, NOW)).toBe('stale');
  });

  it('uses the NEWEST of the two sources', () => {
    expect(integrationStatusOf(ago(INTEGRATION_STALE_AFTER_MS * 3), ago(60_000), NOW)).toBe('healthy');
  });
});

describe('privateIpRatioOf', () => {
  it('sums server rows only and rounds to 3 decimals', () => {
    const rows = [
      sdkRow({ private_ip_events: 46, classified_ip_events: 50 }),
      sdkRow({ sdk: null, private_ip_events: 1, classified_ip_events: 10 }),
      sdkRow({ source: 'browser', private_ip_events: 999, classified_ip_events: 999 }),
    ];
    expect(privateIpRatioOf(rows)).toBe(0.783);
  });

  it('is null below PRIVATE_IP_MIN_EVENTS classified events', () => {
    const rows = [sdkRow({ private_ip_events: 5, classified_ip_events: PRIVATE_IP_MIN_EVENTS - 1 })];
    expect(privateIpRatioOf(rows)).toBeNull();
    expect(privateIpRatioOf([])).toBeNull();
  });
});

describe('countersBySource', () => {
  it('returns server then browser, zero-filling a missing source', () => {
    expect(countersBySource([counter({ source: 'browser', accepted: 3 })])).toEqual([
      { source: 'server', accepted: 0, duplicates: 0, rejected: 0, rateLimited: 0 },
      { source: 'browser', accepted: 3, duplicates: 0, rejected: 0, rateLimited: 0 },
    ]);
  });
});

describe('integrationWarningsOf', () => {
  it('has nothing to say about a healthy app', () => {
    expect(integrationWarningsOf(HEALTHY)).toEqual([]);
  });

  it('flags every problem, most urgent first', () => {
    expect(
      integrationWarningsOf({
        isActive: false,
        status: 'stale',
        exposedKeys: 1,
        privateIpRatio: 0.95,
        sdks: [sdkDto(-(CLOCK_SKEW_WARN_MS + 1))],
        counters: [counter({ rejected: 2 }), counter({ source: 'browser', rateLimited: 1 })],
      }),
    ).toEqual([
      'exposed_key',
      'app_disabled',
      'stale',
      'private_ips',
      'clock_skew',
      'rejected_events',
      'rate_limited',
    ]);
  });

  it('never_received for an app without events', () => {
    expect(integrationWarningsOf({ ...HEALTHY, status: 'never' })).toEqual(['never_received']);
  });

  it('thresholds are strict: exactly 90 % private / exactly the skew limit do not warn', () => {
    expect(integrationWarningsOf({ ...HEALTHY, privateIpRatio: 0.9 })).toEqual([]);
    expect(integrationWarningsOf({ ...HEALTHY, privateIpRatio: null })).toEqual([]);
    expect(integrationWarningsOf({ ...HEALTHY, sdks: [sdkDto(CLOCK_SKEW_WARN_MS)] })).toEqual([]);
    expect(integrationWarningsOf({ ...HEALTHY, sdks: [sdkDto(null)] })).toEqual([]);
  });
});
