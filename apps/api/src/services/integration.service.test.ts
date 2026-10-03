import { INTEGRATION_HEALTH_WINDOW_MS } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import type { AppHealthRow, IngestHealthRows } from '../domain/rows';
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
  const service = new IntegrationService(repo as unknown as IngestHealthRepository, new FixedClock(NOW));
  return { repo, service };
}

const EMPTY: IngestHealthRows = { apps: [], counters: [], sdks: [], exposedKeys: [] };

describe('IntegrationService.health', () => {
  it('asks for the trailing window ending now and echoes it', async () => {
    const { repo, service } = build(EMPTY);
    const result = await service.health();
    const from = new Date(NOW.getTime() - INTEGRATION_HEALTH_WINDOW_MS);
    expect(repo.calls).toEqual([[from, NOW]]);
    expect(result).toEqual({ from: from.toISOString(), to: NOW.toISOString(), apps: [] });
  });

  it("assembles each app from ITS rows only (sdks busiest first, both counter sources)", async () => {
    const { service } = build({
      apps: [appHealthRow(), appHealthRow({ app_id: 'id-b', slug: 'app-b', last_server_at: null })],
      counters: [
        { app_id: 'id-a', source: 'server', accepted: 50, duplicates: 2, rejected: 1, rate_limited: 0 },
        { app_id: 'id-b', source: 'browser', accepted: 9, duplicates: 0, rejected: 0, rate_limited: 0 },
      ],
      sdks: [
        {
          app_id: 'id-a',
          source: 'server',
          sdk: 'curl@1.0.0',
          events: 3,
          last_seen_at: RECENT,
          median_skew_ms: 12.4,
          max_abs_skew_ms: 30,
          private_ip_events: 3,
          classified_ip_events: 3,
        },
        {
          app_id: 'id-a',
          source: 'server',
          sdk: '@nexus/express@1.0.0',
          events: 40,
          last_seen_at: RECENT,
          median_skew_ms: 80_000,
          max_abs_skew_ms: 90_000,
          private_ip_events: 38,
          classified_ip_events: 40,
        },
      ],
      exposedKeys: [
        { app_id: 'id-a', id: 'k1', key_prefix: 'nx_sk_AbCdEfGh', label: 'prod', exposed_at: RECENT },
      ],
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
      exposedKeys: [{ id: 'k1', keyPrefix: 'nx_sk_AbCdEfGh', label: 'prod', exposedAt: RECENT.toISOString() }],
      warnings: ['exposed_key', 'private_ips', 'clock_skew', 'rejected_events'],
    });
    expect(a?.sdks.map((s) => s.sdk)).toEqual(['@nexus/express@1.0.0', 'curl@1.0.0']);
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
    });
    expect(b?.counters.map((c) => [c.source, c.accepted])).toEqual([
      ['server', 0],
      ['browser', 9],
    ]);
  });
});
