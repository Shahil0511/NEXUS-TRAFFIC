import { ACTIVE_USER_WINDOW_MS, ERROR_CODES } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { trafficBucketRow, trafficSummaryRow } from '../../test/fixtures/analytics-rows';
import {
  FakeApiRequestQueries,
  FakeAppSlugs,
  FakeWebEventQueries,
  KNOWN_APP_ID,
} from '../../test/fixtures/fake-query-repositories';
import { AppError, NotFoundError } from '../errors/app-error';
import { FixedClock } from '../lib/clock';
import type { ApiRequestQueryRepository } from '../repositories/api-request-query.repository';
import type { WebEventQueryRepository } from '../repositories/web-event-query.repository';
import type { AppSlugResolver } from './app-slug.resolver';
import { OverviewService } from './overview.service';

const NOW = new Date('2026-10-01T10:00:00.000Z');

function build() {
  const requests = new FakeApiRequestQueries();
  const webEvents = new FakeWebEventQueries();
  const service = new OverviewService(
    requests as unknown as ApiRequestQueryRepository,
    webEvents as unknown as WebEventQueryRepository,
    new FakeAppSlugs() as unknown as AppSlugResolver,
    new FixedClock(NOW),
  );
  return { service, requests, webEvents };
}

describe('OverviewService.summary', () => {
  it('compares every KPI with the previous equal-length window', async () => {
    const { service, requests, webEvents } = build();
    requests.summaries = [
      trafficSummaryRow({ requests: 200, errors: 10, p95_ms: 150, identified_users: 12 }),
      trafficSummaryRow({ requests: 100, errors: 10, p95_ms: 100, identified_users: 0 }),
    ];
    webEvents.pageViews = [30, 20];
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
