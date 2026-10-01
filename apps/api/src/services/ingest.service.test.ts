import { randomUUID } from 'node:crypto';

import { ERROR_CODES, INGEST_CONTRACT_VERSION, type ServerIngestEnvelope } from '@nexus/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fake,
  FIXED_NOW,
  ingestContext,
  serverEvent,
  silentLogger,
  testServerEventEnricher,
} from '../../test/ingest-fixtures';
import type { ApiRequestInsert, IngestCounterIncrement } from '../domain/inserts';
import type { AppRow } from '../domain/rows';
import { EventTimeGuard } from '../enrichment/event-time.guard';
import { AppError } from '../errors/app-error';
import type { Logger } from '../lib/logger';
import type { LiveFeed } from '../live/live-feed';
import type { ApiRequestIngestRepository } from '../repositories/api-request-ingest.repository';
import type { IngestCounterRepository } from '../repositories/ingest-counter.repository';
import type { PartitionRepository } from '../repositories/partition.repository';
import { IngestService } from './ingest.service';
import { PARTITION_MONTHS_AHEAD, PARTITION_MONTHS_BACK } from './partition.service';

// ─── pg error shapes (as node-postgres raises them) ─────────────────────────
const MISSING_PARTITION = { code: '23514', message: 'no partition of relation "api_requests" found for row' };
const CHECK_VIOLATION = { code: '23514', constraint: 'api_requests_path_check', message: 'violates check' };
const POOL_TIMEOUT = { message: 'timeout exceeded when trying to connect' };

/** In-memory api_requests: ON CONFLICT DO NOTHING semantics, injectable failures. */
class FakeApiRequests implements Pick<ApiRequestIngestRepository, 'insertBatch'> {
  stored = new Set<string>();
  poisonEventIds = new Set<string>();
  missingPartitionFailures = 0;
  failWith: unknown = null;
  insertBatch = vi.fn(async (rows: ApiRequestInsert[]): Promise<string[]> => {
    if (this.failWith) throw this.failWith;
    if (this.missingPartitionFailures > 0) {
      this.missingPartitionFailures -= 1;
      throw MISSING_PARTITION;
    }
    if (rows.some((row) => this.poisonEventIds.has(row.eventId))) throw CHECK_VIOLATION;
    const inserted: string[] = [];
    for (const row of rows) {
      if (this.stored.has(row.eventId)) continue;
      this.stored.add(row.eventId);
      inserted.push(row.eventId);
    }
    return inserted;
  });
}

class FakeCounters implements Pick<IngestCounterRepository, 'increment'> {
  increment = vi.fn(async (_increment: IngestCounterIncrement, _at: Date) => undefined);
}

class FakePartitions implements Pick<PartitionRepository, 'ensure'> {
  ensure = vi.fn(async (_back: number, _ahead: number) => ['api_requests_2026_10']);
}

class FakeLiveFeed implements Pick<LiveFeed, 'recordApiRequests'> {
  recordApiRequests = vi.fn((_app: AppRow, _rows: readonly ApiRequestInsert[]) => undefined);
}

function envelope(events: unknown[]): ServerIngestEnvelope {
  return { sentAt: '2026-10-01T09:59:59.000Z', events };
}

describe('IngestService.ingestServerEvents', () => {
  let apiRequests: FakeApiRequests;
  let counters: FakeCounters;
  let partitions: FakePartitions;
  let liveFeed: FakeLiveFeed;
  let logger: Logger;
  let service: IngestService;
  const ctx = ingestContext();

  beforeEach(() => {
    apiRequests = new FakeApiRequests();
    counters = new FakeCounters();
    partitions = new FakePartitions();
    liveFeed = new FakeLiveFeed();
    logger = silentLogger();
    service = new IngestService(
      fake<ApiRequestIngestRepository>(apiRequests),
      fake<IngestCounterRepository>(counters),
      fake<PartitionRepository>(partitions),
      testServerEventEnricher(),
      new EventTimeGuard(),
      fake<LiveFeed>(liveFeed),
      logger,
    );
  });

  const ingest = (events: unknown[], dryRun = false) =>
    service.ingestServerEvents(envelope(events), ctx, { dryRun });

  it('accepts a valid batch, counts it and publishes the inserted rows live', async () => {
    const events = [serverEvent(), serverEvent(), serverEvent()];
    const result = await ingest(events);

    expect(result).toEqual({ accepted: 3, duplicates: 0, rejected: [], warnings: [] });
    expect(apiRequests.insertBatch).toHaveBeenCalledTimes(1);
    const [rows] = apiRequests.insertBatch.mock.calls[0]!;
    expect(rows.map((r) => r.eventId)).toEqual(events.map((e) => e.eventId));
    expect(rows[0]?.clockSkewMs).toBe(1000);
    expect(counters.increment).toHaveBeenCalledWith(
      { appId: ctx.app.id, source: 'server', accepted: 3, duplicates: 0, rejected: 0, rateLimited: 0 },
      FIXED_NOW,
    );
    expect(liveFeed.recordApiRequests).toHaveBeenCalledWith(ctx.app, rows);
  });

  it('rejects invalid and out-of-window events with their original indexes', async () => {
    const result = await ingest([
      serverEvent(),
      { ...serverEvent(), status: 99 },
      'not an object',
      serverEvent({ occurredAt: '2026-09-20T00:00:00.000Z' }),
      serverEvent({ occurredAt: '2026-10-01T10:06:00.000Z' }),
      serverEvent({ userEmail: 'nope' }),
    ]);

    expect(result.accepted).toBe(2);
    expect(result.rejected.map((r) => [r.index, r.code])).toEqual([
      [1, ERROR_CODES.INVALID_EVENT],
      [2, ERROR_CODES.INVALID_EVENT],
      [3, ERROR_CODES.EVENT_TIME_OUT_OF_RANGE],
      [4, ERROR_CODES.EVENT_TIME_OUT_OF_RANGE],
    ]);
    expect(result.rejected[0]?.message).toMatch(/^status: /);
    expect(result.warnings).toEqual([{ index: 5, code: ERROR_CODES.FIELD_DROPPED, field: 'userEmail' }]);
    expect(counters.increment.mock.calls[0]?.[0]).toMatchObject({ accepted: 2, rejected: 4 });
  });

  it('never echoes submitted values in rejection messages', async () => {
    const result = await ingest([{ ...serverEvent(), method: 'SECRET-VALUE-123' }]);
    expect(result.rejected[0]?.message).toMatch(/^method: /);
    expect(result.rejected[0]?.message).not.toContain('SECRET-VALUE-123');
  });

  it('counts later copies of an eventId within the batch as duplicates', async () => {
    const first = serverEvent();
    const result = await ingest([first, serverEvent(), { ...first, durationMs: 99 }, { ...first, eventId: first.eventId.toUpperCase() }]);

    expect(result).toMatchObject({ accepted: 2, duplicates: 2, rejected: [] });
    const [rows] = apiRequests.insertBatch.mock.calls[0]!;
    expect(rows).toHaveLength(2);
    expect(rows[0]?.durationMs).toBe(first.durationMs);
  });

  it('reports rows the DB already had as duplicates and keeps them off the live feed', async () => {
    const known = serverEvent();
    apiRequests.stored.add(known.eventId);
    const fresh = serverEvent();
    const result = await ingest([known, fresh]);

    expect(result).toMatchObject({ accepted: 1, duplicates: 1 });
    const [, liveRows] = liveFeed.recordApiRequests.mock.calls[0]!;
    expect(liveRows.map((r) => r.eventId)).toEqual([fresh.eventId]);
  });

  it('does not publish to the live feed when nothing new was inserted', async () => {
    const known = serverEvent();
    apiRequests.stored.add(known.eventId);
    await ingest([known]);
    expect(liveFeed.recordApiRequests).not.toHaveBeenCalled();
  });

  it('creates missing partitions and retries the insert once', async () => {
    apiRequests.missingPartitionFailures = 1;
    const result = await ingest([serverEvent(), serverEvent()]);

    expect(result.accepted).toBe(2);
    expect(partitions.ensure).toHaveBeenCalledWith(PARTITION_MONTHS_BACK, PARTITION_MONTHS_AHEAD);
    expect(apiRequests.insertBatch).toHaveBeenCalledTimes(2);
  });

  it('a partition still missing after the retry → 503 INGEST_UNAVAILABLE', async () => {
    apiRequests.missingPartitionFailures = 2;
    await expect(ingest([serverEvent()])).rejects.toMatchObject({
      statusCode: 503,
      code: ERROR_CODES.INGEST_UNAVAILABLE,
    });
    expect(partitions.ensure).toHaveBeenCalledTimes(1);
  });

  it('bisects a failing batch and rejects only the poison rows, with their original indexes', async () => {
    const events = Array.from({ length: 7 }, () => serverEvent());
    const invalid = { ...serverEvent(), status: 1 };
    const batch = [events[0], invalid, ...events.slice(1)];
    // batch indexes: 0 ok, 1 invalid, 2..7 = events[1..6]; poison events[2] (index 3) and events[5] (index 6)
    apiRequests.poisonEventIds.add(events[2]!.eventId.toLowerCase());
    apiRequests.poisonEventIds.add(events[5]!.eventId.toLowerCase());

    const result = await ingest(batch);

    expect(result.accepted).toBe(5);
    expect(result.duplicates).toBe(0);
    expect(result.rejected.map((r) => [r.index, r.code])).toEqual([
      [1, ERROR_CODES.INVALID_EVENT],
      [3, ERROR_CODES.DB_CONSTRAINT],
      [6, ERROR_CODES.DB_CONSTRAINT],
    ]);
    expect(result.rejected[1]?.message).not.toContain('violates');
    expect(apiRequests.stored.size).toBe(5);
    const [, liveRows] = liveFeed.recordApiRequests.mock.calls[0]!;
    expect(liveRows).toHaveLength(5);
  });

  it('a single poison row is rejected without bisecting further', async () => {
    const only = serverEvent();
    apiRequests.poisonEventIds.add(only.eventId);
    const result = await ingest([only]);
    expect(result).toMatchObject({ accepted: 0, duplicates: 0 });
    expect(result.rejected).toEqual([{ index: 0, code: ERROR_CODES.DB_CONSTRAINT, message: expect.any(String) }]);
    expect(apiRequests.insertBatch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['pool timeout', POOL_TIMEOUT],
    ['connection failure', { code: '08006' }],
    ['too many connections', { code: '53300' }],
  ])('%s → 503 INGEST_UNAVAILABLE with Retry-After', async (_label, error) => {
    apiRequests.failWith = error;
    const failure = await ingest([serverEvent()]).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(AppError);
    expect(failure).toMatchObject({ statusCode: 503, code: ERROR_CODES.INGEST_UNAVAILABLE });
    expect((failure as AppError).headers?.['Retry-After']).toBeDefined();
    expect(counters.increment).not.toHaveBeenCalled();
  });

  it('rethrows unexpected errors untouched', async () => {
    const boom = new Error('boom');
    apiRequests.failWith = boom;
    await expect(ingest([serverEvent()])).rejects.toBe(boom);
  });

  it('dryRun validates and enriches but writes, counts and publishes nothing', async () => {
    const first = serverEvent();
    const result = await ingest([first, { ...first }, { ...serverEvent(), path: 'no-slash' }], true);

    expect(result).toEqual({
      accepted: 2,
      duplicates: 0,
      rejected: [{ index: 2, code: ERROR_CODES.INVALID_EVENT, message: expect.stringMatching(/^path: /) }],
      warnings: [],
      dryRun: true,
    });
    expect(apiRequests.insertBatch).not.toHaveBeenCalled();
    expect(counters.increment).not.toHaveBeenCalled();
    expect(liveFeed.recordApiRequests).not.toHaveBeenCalled();
  });

  it('a counter failure is logged and never fails the request', async () => {
    counters.increment.mockRejectedValueOnce(new Error('counter down'));
    const warn = vi.spyOn(logger, 'warn');
    await expect(ingest([serverEvent()])).resolves.toMatchObject({ accepted: 1 });
    expect(warn).toHaveBeenCalledWith('ingest counter update failed', expect.anything());
    expect(liveFeed.recordApiRequests).toHaveBeenCalled();
  });

  it('a live feed failure is logged and never fails the request', async () => {
    liveFeed.recordApiRequests.mockImplementationOnce(() => {
      throw new Error('live down');
    });
    const warn = vi.spyOn(logger, 'warn');
    await expect(ingest([serverEvent()])).resolves.toMatchObject({ accepted: 1 });
    expect(warn).toHaveBeenCalledWith('live feed update failed', expect.anything());
  });

  it('skew is null when the envelope sentAt is unusable', async () => {
    await service.ingestServerEvents({ sentAt: 'garbage', events: [serverEvent({ eventId: randomUUID() })] }, ctx, {
      dryRun: false,
    });
    expect(apiRequests.insertBatch.mock.calls[0]?.[0][0]?.clockSkewMs).toBeNull();
  });
});

describe('IngestService.verify', () => {
  it('describes the authenticated app and key', () => {
    const service = new IngestService(
      fake<ApiRequestIngestRepository>({}),
      fake<IngestCounterRepository>({}),
      fake<PartitionRepository>({}),
      testServerEventEnricher(),
      new EventTimeGuard(),
      fake<LiveFeed>({}),
      silentLogger(),
    );
    expect(service.verify(ingestContext())).toEqual({
      app: { slug: 'ebo-sales', displayName: 'EBO Sales' },
      keyKind: 'secret',
      contractVersion: INGEST_CONTRACT_VERSION,
      serverTime: FIXED_NOW.toISOString(),
    });
  });
});
