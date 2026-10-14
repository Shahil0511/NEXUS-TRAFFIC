import { ERROR_CODES, type EndpointListQuery } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import {
  ADMIN_VIEWER,
  apiRequestSampleRow,
  ENDPOINT_ID,
  endpointStatsRow,
  PLAIN_VIEWER,
  trafficBucketRow,
} from '../../test/fixtures/analytics-rows';
import {
  FakeApiRequestQueries,
  FakeAppSlugs,
  KNOWN_APP_ID,
} from '../../test/fixtures/fake-query-repositories';
import { decodeOffsetCursor, encodeOffsetCursor } from '../db/sql';
import { NotFoundError } from '../errors/app-error';
import { FixedClock } from '../lib/clock';
import type { ApiRequestQueryRepository } from '../repositories/api-request-query.repository';
import type { AppSlugResolver } from './app-slug.resolver';
import { EndpointService } from './endpoint.service';

const NOW = new Date('2026-10-01T10:00:00.000Z');

function build() {
  const requests = new FakeApiRequestQueries();
  const service = new EndpointService(
    requests as unknown as ApiRequestQueryRepository,
    new FakeAppSlugs() as unknown as AppSlugResolver,
    new FixedClock(NOW),
  );
  return { service, requests };
}

const listQuery = (overrides: Partial<EndpointListQuery> = {}): EndpointListQuery => ({
  range: '24h',
  sort: 'calls',
  dir: 'desc',
  limit: 2,
  ...overrides,
});

describe('EndpointService.list', () => {
  it('passes sort, direction, search and limit + 1 to the repository', async () => {
    const { service, requests } = build();
    await service.list(listQuery({ sort: 'p95', dir: 'asc', search: 'stores', app: 'ebo-sales' }));
    const [filter, options] = requests.argsOf('listEndpointStats')[0] ?? [];
    expect(filter).toEqual({
      from: new Date('2026-09-30T10:00:00Z'),
      to: NOW,
      appId: KNOWN_APP_ID,
    });
    expect(options).toEqual({ sort: 'p95', dir: 'asc', search: 'stores', limit: 3, offset: 0 });
  });

  it('returns an offset cursor when one more row came back, and continues from it', async () => {
    const { service, requests } = build();
    requests.endpointStats = [endpointStatsRow(), endpointStatsRow(), endpointStatsRow()];
    const first = await service.list(listQuery());
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBe(encodeOffsetCursor(2));
    expect(decodeOffsetCursor(first.nextCursor ?? undefined)).toBe(2);

    requests.endpointStats = [endpointStatsRow()];
    const second = await service.list(listQuery({ cursor: first.nextCursor ?? undefined }));
    expect(requests.argsOf('listEndpointStats')[1]?.[1]).toMatchObject({ offset: 2 });
    expect(second.nextCursor).toBeNull();
  });

  it('refuses 90 days (percentiles) with RANGE_TOO_LARGE', async () => {
    const { service } = build();
    await expect(service.list(listQuery({ range: '90d' }))).rejects.toMatchObject({
      code: ERROR_CODES.RANGE_TOO_LARGE,
    });
  });
});

describe('EndpointService.detail', () => {
  const detailRows = () => ({
    stats: endpointStatsRow(),
    timeseries: [trafficBucketRow({ bucket: new Date('2026-10-01T08:30:00Z') })],
    statusBreakdown: [
      { status_code: 200, count: 192 },
      { status_code: 500, count: 8 },
    ],
    slowest: [apiRequestSampleRow()],
    uniqueUsers: 3,
    topUsers: [
      {
        user_key: Buffer.alloc(32, 0xab),
        user_email: 'a@libas.in',
        count: 7,
        last_seen_at: new Date('2026-10-01T09:00:00Z'),
      },
    ],
  });

  it('404 when the endpoint has no traffic in the window', async () => {
    const { service } = build();
    await expect(
      service.detail(ENDPOINT_ID, { range: '24h' }, ADMIN_VIEWER),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('maps stats, a gap-filled hourly series, the status breakdown and the slowest calls', async () => {
    const { service, requests } = build();
    requests.detail = detailRows();
    const dto = await service.detail(ENDPOINT_ID, { range: '24h' }, ADMIN_VIEWER);
    expect(requests.argsOf('getEndpointDetail')[0]?.[0]).toBe(ENDPOINT_ID);
    expect(dto.endpoint.endpointId).toBe(ENDPOINT_ID);
    // 24 h from 10:00Z: the IST-aligned hour buckets start at 09:30Z the day before → 25 buckets.
    expect(dto.timeseries).toHaveLength(25);
    expect(dto.statusBreakdown).toEqual([
      { status: 200, count: 192 },
      { status: 500, count: 8 },
    ]);
    expect(dto.slowest[0]?.actor.ip).toBe('8.8.8.8');
  });

  it('hides IPs of the slowest calls from non-admins', async () => {
    const { service, requests } = build();
    requests.detail = detailRows();
    const dto = await service.detail(ENDPOINT_ID, { range: '24h' }, PLAIN_VIEWER);
    expect(dto.slowest[0]?.actor.ip).toBeNull();
  });
});
