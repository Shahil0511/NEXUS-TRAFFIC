import { INTEGRATION_HEALTH_WINDOW_MS } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import type { AppHealthRow, IngestHealthRows, SdkHealthRow } from '../domain/rows';
import { FixedClock } from '../lib/clock';
import type { IngestHealthRepository } from '../repositories/ingest-health.repository';
import { IntegrationService } from './integration.service';

const NOW = new Date('2026-10-01T10:00:00.000Z');
const RECENT = new Date('2026-10-01T09:59:00.000Z');

function appHealthRow(overrides: Partial<AppHealthRow> = {}): AppHealthRow {
  return {
    app_id: 'id-a',
    slug: 'app-a',
    display_name: 'App A',
    is_active: true,
    last_server_at: RECENT,
    last_browser_at: null,
    ...overrides,
  };
}

function sdkHealthRow(overrides: Partial<SdkHealthRow> = {}): SdkHealthRow {
  return {
    app_id: 'id-a',
    source: 'server',
    sdk: '@nexus/express@1.1.0',
    events: 100,
    last_seen_at: RECENT,
    median_skew_ms: 10,
    max_abs_skew_ms: 20,
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

class FakeIngestHealth implements Pick<IngestHealthRepository, 'perApp'> {
  readonly calls: Array<[Date, Date]> = [];
  constructor(private readonly rows: IngestHealthRows) {}
  async perApp(from: Date, to: Date): Promise<IngestHealthRows> {
    this.calls.push([from, to]);
    return this.rows;
  }
}

function build(rows: IngestHealthRows) {
  const repo = new FakeIngestHealth(rows);
  const service = new IntegrationService(
    repo as unknown as IngestHealthRepository,
    new FixedClock(NOW),
  );
  return { repo, service };
}

const EMPTY: IngestHealthRows = {
  apps: [],
  counters: [],
  sdks: [],
  exposedKeys: [],
  environmentMix: [],
  rejections: [],
  piiDetections: [],
  ssoOutcomes: [],
};

describe('IntegrationService.health', () => {
  it('asks for the trailing window ending now and echoes it', async () => {
    const { repo, service } = build(EMPTY);
    const result = await service.health();
    const from = new Date(NOW.getTime() - INTEGRATION_HEALTH_WINDOW_MS);
    expect(repo.calls).toEqual([[from, NOW]]);
    expect(result).toEqual({ from: from.toISOString(), to: NOW.toISOString(), apps: [] });
  });

  it('assembles each app from ITS rows only (sdks busiest first, both counter sources)', async () => {
    const { service } = build({
      apps: [appHealthRow(), appHealthRow({ app_id: 'id-b', slug: 'app-b', last_server_at: null })],
      counters: [
        {
          app_id: 'id-a',
          source: 'server',
          accepted: 50,
          duplicates: 2,
          rejected: 1,
          rate_limited: 0,
        },
        {
          app_id: 'id-b',
          source: 'browser',
          accepted: 9,
          duplicates: 0,
          rejected: 0,
          rate_limited: 0,
        },
      ],
      sdks: [
        sdkHealthRow({
          sdk: 'curl@1.0.0',
          events: 3,
          median_skew_ms: 12.4,
          max_abs_skew_ms: 30,
          private_ip_events: 3,
          classified_ip_events: 3,
        }),
        sdkHealthRow({
          sdk: '@nexus/express@1.0.0',
          events: 40,
          median_skew_ms: 80_000,
          max_abs_skew_ms: 90_000,
          private_ip_events: 38,
          classified_ip_events: 40,
        }),
      ],
      exposedKeys: [
        {
          app_id: 'id-a',
          id: 'k1',
          key_prefix: 'nx_sk_AbCdEfGh',
          label: 'prod',
          exposed_at: RECENT,
        },
      ],
      environmentMix: [],
      rejections: [],
      piiDetections: [],
      ssoOutcomes: [],
    });

    const { apps } = await service.health();
    const [a, b] = apps;

    expect(a).toMatchObject({
      app: 'app-a',
      displayName: 'App A',
      isActive: true,
      status: 'healthy',
      lastServerEventAt: RECENT.toISOString(),
      lastBrowserEventAt: null,
      privateIpRatio: 0.953,
      exposedKeys: [
        { id: 'k1', keyPrefix: 'nx_sk_AbCdEfGh', label: 'prod', exposedAt: RECENT.toISOString() },
      ],
      warnings: ['exposed_key', 'private_ips', 'clock_skew', 'rejected_events'],
    });
    expect(a?.sdks.map((s) => s.sdk)).toEqual(['@nexus/express@1.0.0', 'curl@1.0.0']);
    expect(a?.sdks[0]).toMatchObject({ name: '@nexus/express', version: '1.0.0' });
    expect(a?.level).toBe('partial');
    expect(a?.sdks[1]?.medianClockSkewMs).toBe(12);
    expect(a?.counters.map((c) => [c.source, c.accepted])).toEqual([
      ['server', 50],
      ['browser', 0],
    ]);

    expect(b).toMatchObject({
      app: 'app-b',
      status: 'never',
      sdks: [],
      exposedKeys: [],
      privateIpRatio: null,
      warnings: ['never_received'],
      level: 'not_connected',
      identityCoverage: [
        { source: 'server', events: 0, covered: 0, ratio: null },
        { source: 'browser', events: 0, covered: 0, ratio: null },
      ],
      linkingCoverage: { linkable: 0, linked: 0, pageViewLinked: 0, ratio: null },
      environments: [],
      piiDetections: [],
      rejections: [],
      ssoCookieOutcomes: [],
    });
    expect(b?.counters.map((c) => [c.source, c.accepted])).toEqual([
      ['server', 0],
      ['browser', 9],
    ]);
  });
});

describe('IntegrationService.health — diagnostics (ADR 0013)', () => {
  const both = appHealthRow({ last_browser_at: RECENT });
  const sdks = [
    sdkHealthRow({
      events: 100,
      identified: 40,
      linkable: 50,
      linked: 45,
      page_view_linked: 30,
      with_release: 100,
      latest_release: '2026.10.01-a',
      latest_release_at: RECENT,
    }),
    sdkHealthRow({
      source: 'browser',
      sdk: '@nexus/react@1.1.0',
      events: 200,
      identified: 190,
      with_release: 200,
      latest_release: '2026.10.01-b',
      latest_release_at: RECENT,
    }),
  ];
  const rows: IngestHealthRows = {
    ...EMPTY,
    apps: [both],
    sdks,
    environmentMix: [
      { app_id: 'id-a', source: 'server', environment: 'prod', events: 90 },
      { app_id: 'id-a', source: 'server', environment: 'staging', events: 10 },
      { app_id: 'id-x', source: 'server', environment: 'dev', events: 1 },
    ],
    rejections: [
      {
        app_id: 'id-a',
        source: 'browser',
        sdk: '',
        code: 'ORIGIN_NOT_ALLOWED',
        schema_path: '',
        rejected: 7,
      },
      {
        app_id: 'id-a',
        source: 'server',
        sdk: '@nexus/express@1.1.0',
        code: 'INVALID_EVENT',
        schema_path: 'events.*.path',
        rejected: 2,
      },
    ],
    ssoOutcomes: [
      { app_id: 'id-a', outcome: 'no-cookie', beacon_origin: 'cross_origin', beacons: 12 },
    ],
  };

  it("maps coverage, the environment mix, rejections ('' → null) and SSO outcomes; complete level", async () => {
    const { service } = build(rows);
    const [a] = (await service.health()).apps;
    expect(a).toMatchObject({
      identityCoverage: [
        { source: 'server', events: 100, covered: 40, ratio: 0.4 },
        { source: 'browser', events: 200, covered: 190, ratio: 0.95 },
      ],
      linkingCoverage: { linkable: 50, linked: 45, pageViewLinked: 30, ratio: 0.9 },
      environments: [
        { source: 'server', environment: 'prod', events: 90 },
        { source: 'server', environment: 'staging', events: 10 },
      ],
      releases: [
        { source: 'server', withRelease: 100, ratio: 1, latestRelease: '2026.10.01-a' },
        { source: 'browser', withRelease: 200, ratio: 1, latestRelease: '2026.10.01-b' },
      ],
      rejections: [
        { source: 'browser', sdk: null, code: 'ORIGIN_NOT_ALLOWED', schemaPath: null, rejected: 7 },
        {
          source: 'server',
          sdk: '@nexus/express@1.1.0',
          code: 'INVALID_EVENT',
          schemaPath: 'events.*.path',
          rejected: 2,
        },
      ],
      ssoCookieOutcomes: [{ outcome: 'no-cookie', beaconOrigin: 'cross_origin', beacons: 12 }],
      warnings: [],
      level: 'complete',
    });
  });

  it('a PII detection raises pii_detected (right after exposed_key) and blocks `complete`', async () => {
    const { service } = build({
      ...rows,
      piiDetections: [
        { app_id: 'id-a', source: 'browser', field: 'path', kind: 'phone', detections: 3 },
      ],
    });
    const [a] = (await service.health()).apps;
    expect(a?.warnings).toEqual(['pii_detected']);
    expect(a?.piiDetections).toEqual([
      { source: 'browser', field: 'path', kind: 'phone', detections: 3 },
    ]);
    expect(a?.level).toBe('connected');
  });
});
