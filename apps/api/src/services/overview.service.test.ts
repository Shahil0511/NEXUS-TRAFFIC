import { ACTIVE_USER_WINDOW_MS, ERROR_CODES } from '@nexus/shared';
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
    });
    expect(previous).toEqual({
      from: new Date('2026-10-01T08:00:00Z'),
      to: new Date('2026-10-01T09:00:00Z'),
      appId: KNOWN_APP_ID,
    });
    const active = webEvents.calls.find((c) => c.method === 'countActiveUsers')?.args[0];
    expect(active).toEqual({
      from: new Date(NOW.getTime() - ACTIVE_USER_WINDOW_MS),
      to: NOW,
      appId: KNOWN_APP_ID,
    });
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
      [{ app_id: OTHER_APP_ID, requests: 50, errors: 5, p95_ms: 120.123, last_event_at: seenAt }],
      [{ app_id: OTHER_APP_ID, requests: 25, errors: 0, p95_ms: 90, last_event_at: seenAt }],
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
    });
    expect(dto.items[1]).toMatchObject({
      app: 'ebo-sales',
      requests: { value: 0 },
      errorRate: { value: null },
      lastEventAt: null,
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
