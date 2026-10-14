import { ERROR_CODES, type ErrorListQuery } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import {
  ADMIN_VIEWER,
  apiRequestSampleRow,
  ENDPOINT_ID,
  endpointStatsRow,
  PLAIN_VIEWER,
} from '../../test/fixtures/analytics-rows';
import { FakeApiRequestQueries, FakeAppSlugs } from '../../test/fixtures/fake-query-repositories';
import { encodeKeysetCursor } from '../db/sql';
import { BadRequestError } from '../errors/app-error';
import { FixedClock } from '../lib/clock';
import type { ApiRequestQueryRepository } from '../repositories/api-request-query.repository';
import type { AppSlugResolver } from './app-slug.resolver';
import { ErrorService } from './error.service';

const NOW = new Date('2026-10-01T10:00:00.000Z');
const ID_1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const ID_2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const ID_3 = 'aaaaaaaa-0000-4000-8000-000000000003';

function build() {
  const requests = new FakeApiRequestQueries();
  const service = new ErrorService(
    requests as unknown as ApiRequestQueryRepository,
    new FakeAppSlugs() as unknown as AppSlugResolver,
    new FixedClock(NOW),
  );
  return { service, requests };
}

/** A failed-request row at a µs-precision time (as the repository SELECTs it). */
const sampleAt = (eventId: string, occurredAtKey: string) =>
  apiRequestSampleRow({
    event_id: eventId,
    occurred_at: new Date(occurredAtKey),
    occurred_at_key: occurredAtKey,
  });

const listQuery = (overrides: Partial<ErrorListQuery> = {}): ErrorListQuery => ({
  range: '24h',
  statusClass: 'all',
  limit: 2,
  ...overrides,
});

describe('ErrorService.summary', () => {
  it('maps totals, statuses, a filled series and the top failing endpoints', async () => {
    const { service, requests } = build();
    requests.errorSummary = {
      totals: { total: 9, errors_4xx: 6, errors_5xx: 3 },
      byStatus: [
        { status_code: 404, count: 6 },
        { status_code: 500, count: 3 },
      ],
      timeseries: [],
      topEndpoints: [endpointStatsRow()],
      usersAffected: 1,
      topAffectedUsers: [
        { user_key: Buffer.alloc(32, 0xab), user_email: 'a@libas.in', count: 4, last_seen_at: NOW },
      ],
    };
    const dto = await service.summary({ range: '6h' });
    expect(dto).toMatchObject({ total: 9, errors4xx: 6, errors5xx: 3 });
    expect(dto.byStatus).toEqual([
      { status: 404, count: 6 },
      { status: 500, count: 3 },
    ]);
    expect(dto.timeseries).toHaveLength(360);
    expect(dto.topEndpoints[0]?.endpointId).toBe(ENDPOINT_ID);
  });
});

describe('ErrorService.list', () => {
  it('first page: no keyset, limit + 1, status class and endpoint scope passed through', async () => {
    const { service, requests } = build();
    await service.list(listQuery({ statusClass: '5xx', endpointId: ENDPOINT_ID }), ADMIN_VIEWER);
    const [filter, options] = requests.argsOf('listFailures')[0] ?? [];
    expect(filter).toMatchObject({ endpointId: ENDPOINT_ID, to: NOW });
    expect(options).toEqual({ statusClass: '5xx', after: null, limit: 3 });
  });

  it('builds the next keyset cursor from the last SHOWN row and decodes it on the next call', async () => {
    const { service, requests } = build();
    requests.failures = [
      sampleAt(ID_1, '2026-10-01T09:03:00.000001Z'),
      sampleAt(ID_2, '2026-10-01T09:02:00.000002Z'),
      sampleAt(ID_3, '2026-10-01T09:01:00.000003Z'),
    ];
    const page = await service.list(listQuery(), ADMIN_VIEWER);
    expect(page.items.map((i) => i.eventId)).toEqual([ID_1, ID_2]);
    // The cursor keeps the µs digits a Date would drop.
    expect(page.nextCursor).toBe(encodeKeysetCursor('2026-10-01T09:02:00.000002Z', ID_2));

    await service.list(listQuery({ cursor: page.nextCursor ?? undefined }), ADMIN_VIEWER);
    expect(requests.argsOf('listFailures')[1]?.[1]).toMatchObject({
      after: { occurredAt: '2026-10-01T09:02:00.000002Z', eventId: ID_2 },
    });
  });

  it('allows 90 days (counts only, MAX_COUNT_RANGE_MS) but not 120', async () => {
    const { service } = build();
    await expect(service.list(listQuery({ range: '90d' }), ADMIN_VIEWER)).resolves.toMatchObject({
      items: [],
    });
    const custom = listQuery({
      range: 'custom',
      from: '2026-06-01T00:00:00Z',
      to: '2026-10-01T00:00:00Z',
    });
    await expect(service.list(custom, ADMIN_VIEWER)).rejects.toMatchObject({
      code: ERROR_CODES.RANGE_TOO_LARGE,
    });
  });

  it('a malformed cursor is a 400, never a silent restart', async () => {
    const { service } = build();
    await expect(
      service.list(listQuery({ cursor: 'garbage' }), ADMIN_VIEWER),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('non-admins never receive IPs', async () => {
    const { service, requests } = build();
    requests.failures = [apiRequestSampleRow()];
    const page = await service.list(listQuery(), PLAIN_VIEWER);
    expect(page.items[0]?.actor.ip).toBeNull();
    expect(JSON.stringify(page)).not.toContain('8.8.8.8');
  });
});

describe('ErrorService (one user)', () => {
  it('scopes the summary and the list to the user key (bytes), and maps affected users', async () => {
    const { service, requests } = build();
    const key = 'ab'.repeat(32);
    requests.errorSummary = {
      totals: { total: 4, errors_4xx: 4, errors_5xx: 0 },
      byStatus: [],
      timeseries: [],
      topEndpoints: [],
      usersAffected: 1,
      topAffectedUsers: [
        { user_key: Buffer.alloc(32, 0xab), user_email: 'a@libas.in', count: 4, last_seen_at: NOW },
      ],
    };
    const dto = await service.summary({ range: '24h', userKey: key });
    expect(requests.argsOf('summarizeErrors')[0]?.[0]).toMatchObject({
      userKey: Buffer.from(key, 'hex'),
    });
    expect(dto.usersAffected).toBe(1);
    expect(dto.topAffectedUsers).toEqual([
      { userKey: key, email: 'a@libas.in', count: 4, lastSeenAt: NOW.toISOString() },
    ]);
  });
});
