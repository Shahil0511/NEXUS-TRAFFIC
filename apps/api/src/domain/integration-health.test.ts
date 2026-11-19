import {
  CLOCK_SKEW_WARN_MS,
  COVERAGE_MIN_EVENTS,
  INTEGRATION_STALE_AFTER_MS,
  PRIVATE_IP_MIN_EVENTS,
  type CoverageDto,
  type IngestCounterDto,
  type LinkingCoverageDto,
  type ReleaseStatusDto,
  type SdkHealthDto,
} from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import {
  countersBySource,
  coverageRatioOf,
  identityCoverageOf,
  integrationLevelOf,
  integrationStatusOf,
  integrationWarningsOf,
  linkingCoverageOf,
  privateIpRatioOf,
  releaseStatusOf,
  type LevelInputs,
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
    identified: 0,
    linkable: 0,
    linked: 0,
    page_view_linked: 0,
    with_release: 0,
    latest_release: null,
    latest_release_at: null,
    ...overrides,
  };
}

function counter(overrides: Partial<IngestCounterDto> = {}): IngestCounterDto {
  return {
    source: 'server',
    accepted: 10,
    duplicates: 0,
    rejected: 0,
    rateLimited: 0,
    ...overrides,
  };
}

function sdkDto(medianClockSkewMs: number | null): SdkHealthDto {
  return {
    source: 'server',
    sdk: 'x@1',
    name: 'x',
    version: '1',
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
  piiDetections: 0,
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
    expect(integrationStatusOf(ago(INTEGRATION_STALE_AFTER_MS * 3), ago(60_000), NOW)).toBe(
      'healthy',
    );
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
    const rows = [
      sdkRow({ private_ip_events: 5, classified_ip_events: PRIVATE_IP_MIN_EVENTS - 1 }),
    ];
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
        piiDetections: 3,
        privateIpRatio: 0.95,
        sdks: [sdkDto(-(CLOCK_SKEW_WARN_MS + 1))],
        counters: [counter({ rejected: 2 }), counter({ source: 'browser', rateLimited: 1 })],
      }),
    ).toEqual([
      'exposed_key',
      'pii_detected',
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

describe('coverageRatioOf', () => {
  it('is null below COVERAGE_MIN_EVENTS and a 3-decimal ratio from there on', () => {
    expect(coverageRatioOf(5, COVERAGE_MIN_EVENTS - 1)).toBeNull();
    expect(coverageRatioOf(0, 0)).toBeNull();
    expect(coverageRatioOf(2, 3 * COVERAGE_MIN_EVENTS)).toBe(0.033);
    expect(coverageRatioOf(COVERAGE_MIN_EVENTS, COVERAGE_MIN_EVENTS)).toBe(1);
  });
});

describe('identityCoverageOf', () => {
  it('sums the SDK rows PER SOURCE and always returns both sources', () => {
    const rows = [
      sdkRow({ events: 30, identified: 12 }),
      sdkRow({ sdk: null, events: 10, identified: 8 }),
    ];
    expect(identityCoverageOf(rows)).toEqual([
      { source: 'server', events: 40, covered: 20, ratio: 0.5 },
      { source: 'browser', events: 0, covered: 0, ratio: null },
    ]);
  });
});

describe('linkingCoverageOf', () => {
  it('counts linkable / linked / page-view-linked calls (browser rows contribute 0)', () => {
    const rows = [
      sdkRow({ linkable: 40, linked: 30, page_view_linked: 25 }),
      sdkRow({ source: 'browser', events: 500 }),
    ];
    expect(linkingCoverageOf(rows)).toEqual({
      linkable: 40,
      linked: 30,
      pageViewLinked: 25,
      ratio: 0.75,
    });
  });

  it('has no ratio below COVERAGE_MIN_EVENTS linkable calls', () => {
    expect(linkingCoverageOf([sdkRow({ linkable: 3, linked: 3 })]).ratio).toBeNull();
  });
});

describe('releaseStatusOf', () => {
  it('per source: release share and the release of the NEWEST event that had one', () => {
    const rows = [
      sdkRow({
        events: 50,
        with_release: 45,
        latest_release: '2026.10.01-old',
        latest_release_at: ago(60_000),
      }),
      sdkRow({
        sdk: '@nexus/express@1.1.0',
        events: 50,
        with_release: 50,
        latest_release: '2026.10.01-new',
        latest_release_at: ago(1_000),
      }),
      sdkRow({ source: 'browser', events: 5 }),
    ];
    expect(releaseStatusOf(rows)).toEqual([
      {
        source: 'server',
        events: 100,
        withRelease: 95,
        ratio: 0.95,
        latestRelease: '2026.10.01-new',
      },
      { source: 'browser', events: 5, withRelease: 0, ratio: null, latestRelease: null },
    ]);
  });
});

describe('integrationLevelOf', () => {
  const coverage = (source: 'server' | 'browser', events: number, ratio: number | null) =>
    ({ source, events, covered: 0, ratio }) satisfies CoverageDto;
  const release = (source: 'server' | 'browser', ratio: number | null) =>
    ({
      source,
      events: 100,
      withRelease: 0,
      ratio,
      latestRelease: null,
    }) satisfies ReleaseStatusDto;
  const linking = (ratio: number | null): LinkingCoverageDto => ({
    linkable: 100,
    linked: 0,
    pageViewLinked: 0,
    ratio,
  });
  const COMPLETE: LevelInputs = {
    status: 'healthy',
    identityCoverage: [coverage('server', 100, 0.5), coverage('browser', 100, 0.9)],
    linkingCoverage: linking(0.85),
    releases: [release('server', 0.99), release('browser', 0.95)],
    warnings: [],
  };

  it('not_connected without any event, partial when stale or with one source only', () => {
    expect(integrationLevelOf({ ...COMPLETE, status: 'never' })).toBe('not_connected');
    expect(integrationLevelOf({ ...COMPLETE, status: 'stale' })).toBe('partial');
    expect(
      integrationLevelOf({
        ...COMPLETE,
        identityCoverage: [coverage('server', 100, 0.5), coverage('browser', 0, null)],
      }),
    ).toBe('partial');
  });

  it('complete only when linking, browser identity and every release ratio meet their targets', () => {
    expect(integrationLevelOf(COMPLETE)).toBe('complete');
    expect(integrationLevelOf({ ...COMPLETE, linkingCoverage: linking(0.79) })).toBe('connected');
    expect(integrationLevelOf({ ...COMPLETE, linkingCoverage: linking(null) })).toBe('connected');
    expect(
      integrationLevelOf({
        ...COMPLETE,
        identityCoverage: [coverage('server', 100, 0.1), coverage('browser', 100, 0.7)],
      }),
    ).toBe('connected');
    expect(
      integrationLevelOf({
        ...COMPLETE,
        releases: [release('server', 0.94), release('browser', 1)],
      }),
    ).toBe('connected');
  });

  it('a blocking warning (exposed key, PII, disabled) keeps it at connected', () => {
    for (const warning of ['exposed_key', 'pii_detected', 'app_disabled'] as const) {
      expect(integrationLevelOf({ ...COMPLETE, warnings: [warning] })).toBe('connected');
    }
    expect(integrationLevelOf({ ...COMPLETE, warnings: ['clock_skew'] })).toBe('complete');
  });
});
