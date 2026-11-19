import {
  ACTIVE_USER_WINDOW_MS,
  ERROR_CODES,
  RETURNING_DEVICE_LOOKBACK_MS,
  breakdownOverviewQuerySchema,
} from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { trafficBucketRow, trafficSummaryRow } from '../../test/fixtures/analytics-rows';
import { appRow } from '../../test/fixtures/app-rows';
import {
  FakeApiRequestQueries,
  FakeAppSlugs,
  FakeWebEventQueries,
  KNOWN_APP_ID,
} from '../../test/fixtures/fake-query-repositories';
import { AppError, NotFoundError } from '../errors/app-error';
import { FixedClock } from '../lib/clock';
import type { AppRow } from '../domain/rows';
import type { ApiRequestQueryRepository } from '../repositories/api-request-query.repository';
import type { AppRepository } from '../repositories/app.repository';
import type { WebEventQueryRepository } from '../repositories/web-event-query.repository';
import type { AppSlugResolver } from './app-slug.resolver';
import { OverviewService } from './overview.service';

const NOW = new Date('2026-10-01T10:00:00.000Z');

const OTHER_APP_ID = '99999999-9999-4999-8999-999999999999';

/** The registered apps (AppRepository.list), in slug order like the real query. */
class FakeApps implements Pick<AppRepository, 'list'> {
  rows: AppRow[] = [
    appRow({ id: KNOWN_APP_ID, slug: 'ebo-sales', display_name: 'EBO Sales' }),
    appRow({ id: OTHER_APP_ID, slug: 'hr-portal', display_name: 'HR Portal' }),
  ];
  async list(): Promise<AppRow[]> {
    return this.rows;
  }
}

function build() {
  const requests = new FakeApiRequestQueries();
  const webEvents = new FakeWebEventQueries();
  const service = new OverviewService(
    requests as unknown as ApiRequestQueryRepository,
    webEvents as unknown as WebEventQueryRepository,
    new FakeApps() as unknown as AppRepository,
    new FakeAppSlugs() as unknown as AppSlugResolver,
    new FixedClock(NOW),
  );
  return { service, requests, webEvents };
}

describe('OverviewService.summary', () => {
  it('compares every KPI with the previous equal-length window', async () => {
    const { service, requests, webEvents } = build();
    requests.summaries = [
      trafficSummaryRow({ requests: 200, errors: 10, p95_ms: 150 }),
      trafficSummaryRow({ requests: 100, errors: 10, p95_ms: 100 }),
    ];
    webEvents.pageViews = [30, 20];
    webEvents.identifiedUsers = [12, 0];
    webEvents.activeUsers = 4;

    const dto = await service.summary({ range: '24h' });

    expect(dto.requests).toEqual({ value: 200, previous: 100, deltaPct: 100 });
    expect(dto.errorRate).toEqual({ value: 5, previous: 10, deltaPct: -50 });
    expect(dto.p95Ms).toEqual({ value: 150, previous: 100, deltaPct: 50 });
    expect(dto.pageViews).toEqual({ value: 30, previous: 20, deltaPct: 50 });
    expect(dto.identifiedUsers).toEqual({ value: 12, previous: 0, deltaPct: null });
    expect(dto.activeUsersNow).toBe(4);
    expect(dto.window).toEqual({
      from: '2026-09-30T10:00:00.000Z',
      to: NOW.toISOString(),
      grain: 'hour',
    });
  });

  it('queries the current window, the previous window and the last 5 minutes, scoped to the app', async () => {
    const { service, requests, webEvents } = build();
    await service.summary({ range: '1h', app: 'ebo-sales' });

    const [current, previous] = requests.argsOf('summarizeTraffic').map((args) => args[0]);
    expect(current).toEqual({
      from: new Date('2026-10-01T09:00:00Z'),
      to: NOW,
      appId: KNOWN_APP_ID,
      environments: ['prod'],
    });
    expect(previous).toEqual({
      from: new Date('2026-10-01T08:00:00Z'),
      to: new Date('2026-10-01T09:00:00Z'),
      appId: KNOWN_APP_ID,
      environments: ['prod'],
    });
    const active = webEvents.calls.find((c) => c.method === 'countActiveUsers')?.args[0];
    expect(active).toEqual({
      from: new Date(NOW.getTime() - ACTIVE_USER_WINDOW_MS),
      to: NOW,
      appId: KNOWN_APP_ID,
      environments: ['prod'],
    });
  });

  it('applies the env filter to EVERY query (default prod, `all` = no filter)', async () => {
    const staging = build();
    await staging.service.summary({ range: '1h', env: 'staging' });
    const all = build();
    await all.service.summary({ range: '1h', env: 'all' });
    for (const [t, expected] of [
      [staging, ['staging']],
      [all, null],
    ] as const) {
      const filters = [...t.requests.calls, ...t.webEvents.calls].map(
        (c) => (c.args[0] as { environments: unknown }).environments,
      );
      expect(filters.length).toBeGreaterThan(0);
      for (const environments of filters) expect(environments).toEqual(expected);
    }
  });

  it('has a null error rate (not 0 %, not NaN) when there were no requests', async () => {
    const { service, requests } = build();
    requests.summaries = [
      trafficSummaryRow({ requests: 0, errors: 0, p95_ms: null }),
      trafficSummaryRow({ requests: 0, errors: 0 }),
    ];
    const dto = await service.summary({ range: '24h' });
    expect(dto.errorRate).toEqual({ value: null, previous: null, deltaPct: null });
    expect(dto.p95Ms.value).toBeNull();
  });

  it('refuses ranges beyond the percentile cap with 400 RANGE_TOO_LARGE before any query', async () => {
    const { service, requests } = build();
    const err = await service.summary({ range: '90d' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ statusCode: 400, code: ERROR_CODES.RANGE_TOO_LARGE });
    expect(requests.calls).toEqual([]);
  });

  it('answers 404 for an unknown app slug', async () => {
    const { service } = build();
    await expect(service.summary({ range: '24h', app: 'nope' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('OverviewService.apps', () => {
  it('lists every registered app busiest first, silent apps with zeros, with deltas', async () => {
    const { service, requests, webEvents } = build();
    const seenAt = new Date('2026-10-01T09:30:00Z');
    requests.trafficByApp = [
      [
        {
          app_id: OTHER_APP_ID,
          requests: 50,
          errors: 5,
          p95_ms: 120.123,
          last_event_at: seenAt,
          identified: 40,
          linkable: 50,
          linked: 25,
        },
      ],
      [
        {
          app_id: OTHER_APP_ID,
          requests: 25,
          errors: 0,
          p95_ms: 90,
          last_event_at: seenAt,
          identified: 25,
          linkable: 25,
          linked: 25,
        },
      ],
    ];
    webEvents.activityByApp = [
      [
        {
          app_id: OTHER_APP_ID,
          users: 4,
          page_views: 10,
          sessions: 3,
          tool_uses: 2,
          last_event_at: new Date('2026-10-01T09:45:00Z'),
          events: 80,
          identified: 60,
        },
      ],
      [],
    ];

    const dto = await service.apps({ range: '24h' });

    expect(dto.items.map((item) => item.app)).toEqual(['hr-portal', 'ebo-sales']);
    expect(dto.items[0]).toEqual({
      app: 'hr-portal',
      displayName: 'HR Portal',
      requests: { value: 50, previous: 25, deltaPct: 100 },
      errorRate: { value: 10, previous: 0, deltaPct: null },
      p95Ms: 120.12,
      pageViews: { value: 10, previous: 0, deltaPct: null },
      users: { value: 4, previous: 0, deltaPct: null },
      sessions: 3,
      toolUses: 2,
      lastEventAt: '2026-10-01T09:45:00.000Z',
      identifiedPct: 75,
      linkedPct: 50,
    });
    expect(dto.items[1]).toMatchObject({
      app: 'ebo-sales',
      requests: { value: 0 },
      errorRate: { value: null },
      lastEventAt: null,
      identifiedPct: null,
      linkedPct: null,
    });
  });

  it('narrows to the filtered app and scopes every query to it', async () => {
    const { service, requests, webEvents } = build();
    const dto = await service.apps({ range: '24h', app: 'ebo-sales' });
    expect(dto.items.map((item) => item.app)).toEqual(['ebo-sales']);
    expect(requests.argsOf('summarizeTrafficByApp')[0]?.[0]).toMatchObject({ appId: KNOWN_APP_ID });
    expect(webEvents.argsOf('summarizeActivityByApp')[1]?.[0]).toMatchObject({
      appId: KNOWN_APP_ID,
    });
  });
});

describe('OverviewService.timeseries', () => {
  it('fills every bucket of the window and merges page views', async () => {
    const { service, requests, webEvents } = build();
    requests.buckets = [
      trafficBucketRow({ bucket: new Date('2026-10-01T09:10:00Z'), requests: 5 }),
    ];
    webEvents.pageViewBuckets = [{ bucket: new Date('2026-10-01T09:20:00Z'), page_views: 7 }];

    const dto = await service.timeseries({ range: '1h' });

    expect(dto.window.grain).toBe('minute');
    expect(dto.points).toHaveLength(60);
    expect(dto.points[0]?.bucket).toBe('2026-10-01T09:00:00.000Z');
    expect(dto.points.at(-1)?.bucket).toBe('2026-10-01T09:59:00.000Z');
    expect(dto.points.find((p) => p.bucket === '2026-10-01T09:10:00.000Z')?.requests).toBe(5);
    expect(dto.points.find((p) => p.bucket === '2026-10-01T09:20:00.000Z')).toMatchObject({
      requests: 0,
      pageViews: 7,
    });
    expect(requests.argsOf('timeseries')[0]?.[1]).toBe('minute');
  });
});

describe('OverviewService.breakdown', () => {
  it('counts browser page views by the dimension, with shares of the whole window', async () => {
    const { service, webEvents, requests } = build();
    webEvents.breakdown = [
      { value: 'Chrome', events: 75, total: 100 },
      { value: null, events: 5, total: 100 },
    ];
    const query = breakdownOverviewQuerySchema.parse({ dimension: 'browser', app: 'ebo-sales' });

    const dto = await service.breakdown(query);

    expect(dto).toEqual({
      window: { from: '2026-09-30T10:00:00.000Z', to: NOW.toISOString(), grain: 'hour' },
      source: 'browser',
      dimension: 'browser',
      total: 100,
      items: [
        { value: 'Chrome', events: 75, share: 0.75 },
        { value: null, events: 5, share: 0.05 },
      ],
    });
    expect(webEvents.argsOf('countByDimension')).toEqual([
      [
        'browser',
        {
          from: new Date('2026-09-30T10:00:00Z'),
          to: NOW,
          appId: KNOWN_APP_ID,
          environments: ['prod'],
        },
        10,
      ],
    ]);
    expect(requests.calls).toEqual([]);
  });

  it('routes source=server to api_requests and honours env + limit', async () => {
    const { service, webEvents, requests } = build();
    const query = breakdownOverviewQuerySchema.parse({
      source: 'server',
      dimension: 'release',
      env: 'all',
      limit: '5',
    });
    const dto = await service.breakdown(query);
    expect(dto).toMatchObject({ source: 'server', dimension: 'release', total: 0, items: [] });
    const [[dimension, filter, limit]] = requests.argsOf('countByDimension') as [
      [string, { environments: unknown }, number],
    ];
    expect([dimension, filter.environments, limit]).toEqual(['release', null, 5]);
    expect(webEvents.argsOf('countByDimension')).toEqual([]);
  });

  it('allows count ranges (90d) — breakdowns are counts, not percentiles', async () => {
    const { service } = build();
    const dto = await service.breakdown(
      breakdownOverviewQuerySchema.parse({ dimension: 'os', range: '90d' }),
    );
    expect(dto.window.from).toBe('2026-07-03T10:00:00.000Z');
  });
});

describe('OverviewService.devices', () => {
  it('splits devices into new and returning over the bounded lookback', async () => {
    const { service, webEvents } = build();
    webEvents.deviceReturn = { devices: 40, returning_devices: 15 };

    const dto = await service.devices({ range: '24h', env: 'dev' });

    const windowFrom = new Date('2026-09-30T10:00:00Z');
    const lookbackFrom = new Date(windowFrom.getTime() - RETURNING_DEVICE_LOOKBACK_MS);
    expect(dto).toEqual({
      window: { from: windowFrom.toISOString(), to: NOW.toISOString(), grain: 'hour' },
      lookbackFrom: lookbackFrom.toISOString(),
      devices: 40,
      newDevices: 25,
      returningDevices: 15,
    });
    expect(webEvents.argsOf('countDeviceReturn')).toEqual([
      [{ from: windowFrom, to: NOW, appId: undefined, environments: ['dev'] }, lookbackFrom],
    ]);
  });
});
