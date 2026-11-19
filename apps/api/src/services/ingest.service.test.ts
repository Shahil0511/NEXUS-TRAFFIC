import { randomUUID } from 'node:crypto';

import {
  ERROR_CODES,
  INGEST_CONTRACT_VERSION,
  type BrowserIngestEnvelope,
  type ServerIngestEnvelope,
} from '@nexus/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  browserEvent,
  browserIngestContext,
  fake,
  FIXED_NOW,
  ingestContext,
  serverEvent,
  silentLogger,
  testBrowserEventEnricher,
  testServerEventEnricher,
} from '../../test/ingest-fixtures';
import type {
  ApiRequestInsert,
  IngestCounterIncrement,
  IngestRejectionIncrement,
  PiiDetectionIncrement,
  WebEventInsert,
} from '../domain/inserts';
import type { AppRow } from '../domain/rows';
import { EventTimeGuard } from '../enrichment/event-time.guard';
import { AppError } from '../errors/app-error';
import type { Logger } from '../lib/logger';
import type { LiveFeed } from '../live/live-feed';
import type { ApiRequestIngestRepository } from '../repositories/api-request-ingest.repository';
import type { IngestCounterRepository } from '../repositories/ingest-counter.repository';
import type { IngestRejectionRepository } from '../repositories/ingest-rejection.repository';
import type { PartitionRepository } from '../repositories/partition.repository';
import type { PiiDetectionRepository } from '../repositories/pii-detection.repository';
import type { SsoCookieOutcomeRepository } from '../repositories/sso-cookie-outcome.repository';
import type { WebEventIngestRepository } from '../repositories/web-event-ingest.repository';
import { IngestService } from './ingest.service';
import { PARTITION_MONTHS_AHEAD, PARTITION_MONTHS_BACK } from './partition.service';

// ─── pg error shapes (as node-postgres raises them) ─────────────────────────
const MISSING_PARTITION = {
  code: '23514',
  message: 'no partition of relation "api_requests" found for row',
};
const CHECK_VIOLATION = {
  code: '23514',
  constraint: 'api_requests_path_check',
  message: 'violates check',
};
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

class FakeRejections implements Pick<IngestRejectionRepository, 'increment'> {
  increment = vi.fn(async (_appId: string, _rows: readonly IngestRejectionIncrement[], _at: Date) => undefined);
}

class FakePiiDetections implements Pick<PiiDetectionRepository, 'increment'> {
  increment = vi.fn(
    async (_appId: string, _source: string, _rows: readonly PiiDetectionIncrement[], _at: Date) => undefined,
  );
}

class FakeSsoOutcomes implements Pick<SsoCookieOutcomeRepository, 'increment'> {
  increment = vi.fn(async (_appId: string, _outcome: string, _beaconOrigin: string, _at: Date) => undefined);
}

const PUBLIC_ORIGIN = 'https://nexus.libas.in';

interface ServiceDeps {
  apiRequests?: Partial<ApiRequestIngestRepository>;
  webEvents?: Partial<WebEventIngestRepository>;
  counters?: Partial<IngestCounterRepository>;
  rejections?: Partial<IngestRejectionRepository>;
  piiDetections?: Partial<PiiDetectionRepository>;
  ssoOutcomes?: Partial<SsoCookieOutcomeRepository>;
  partitions?: Partial<PartitionRepository>;
  liveFeed?: Partial<LiveFeed>;
  logger?: Logger;
}

/** The service with real enrichers and the given fakes (every repository defaults to a no-op). */
function buildService(deps: ServiceDeps = {}): IngestService {
  return new IngestService(
    fake<ApiRequestIngestRepository>(deps.apiRequests ?? {}),
    fake<WebEventIngestRepository>(deps.webEvents ?? {}),
    fake<IngestCounterRepository>(deps.counters ?? new FakeCounters()),
    fake<IngestRejectionRepository>(deps.rejections ?? new FakeRejections()),
    fake<PiiDetectionRepository>(deps.piiDetections ?? new FakePiiDetections()),
    fake<SsoCookieOutcomeRepository>(deps.ssoOutcomes ?? new FakeSsoOutcomes()),
    fake<PartitionRepository>(deps.partitions ?? new FakePartitions()),
    testServerEventEnricher(),
    testBrowserEventEnricher(),
    new EventTimeGuard(),
    fake<LiveFeed>(deps.liveFeed ?? {}),
    deps.logger ?? silentLogger(),
    PUBLIC_ORIGIN,
  );
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
  let rejections: FakeRejections;
  let piiDetections: FakePiiDetections;
  let logger: Logger;
  let service: IngestService;
  const ctx = ingestContext();

  beforeEach(() => {
    apiRequests = new FakeApiRequests();
    counters = new FakeCounters();
    partitions = new FakePartitions();
    liveFeed = new FakeLiveFeed();
    logger = silentLogger();
    rejections = new FakeRejections();
    piiDetections = new FakePiiDetections();
    service = buildService({ apiRequests, counters, rejections, piiDetections, partitions, liveFeed, logger });
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
      {
        appId: ctx.app.id,
        source: 'server',
        accepted: 3,
        duplicates: 0,
        rejected: 0,
        rateLimited: 0,
      },
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
    expect(result.warnings).toEqual([
      { index: 5, code: ERROR_CODES.FIELD_DROPPED, field: 'userEmail' },
    ]);
    expect(counters.increment.mock.calls[0]?.[0]).toMatchObject({ accepted: 2, rejected: 4 });
  });

  it('never echoes submitted values in rejection messages', async () => {
    const result = await ingest([{ ...serverEvent(), method: 'SECRET-VALUE-123' }]);
    expect(result.rejected[0]?.message).toMatch(/^method: /);
    expect(result.rejected[0]?.message).not.toContain('SECRET-VALUE-123');
  });

  it('counts later copies of an eventId within the batch as duplicates', async () => {
    const first = serverEvent();
    const result = await ingest([
      first,
      serverEvent(),
      { ...first, durationMs: 99 },
      { ...first, eventId: first.eventId.toUpperCase() },
    ]);

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
    expect(result.rejected).toEqual([
      { index: 0, code: ERROR_CODES.DB_CONSTRAINT, message: expect.any(String) },
    ]);
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
    const result = await ingest(
      [first, { ...first }, { ...serverEvent(), path: 'no-slash' }],
      true,
    );

    expect(result).toEqual({
      accepted: 2,
      duplicates: 0,
      rejected: [
        { index: 2, code: ERROR_CODES.INVALID_EVENT, message: expect.stringMatching(/^path: /) },
      ],
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
    await service.ingestServerEvents(
      { sentAt: 'garbage', events: [serverEvent({ eventId: randomUUID() })] },
      ctx,
      {
        dryRun: false,
      },
    );
    expect(apiRequests.insertBatch.mock.calls[0]?.[0][0]?.clockSkewMs).toBeNull();
  });
});

describe('IngestService.verify', () => {
  it('describes the authenticated app and key', () => {
    const service = buildService();
    expect(service.verify(ingestContext())).toEqual({
      app: { slug: 'ebo-sales', displayName: 'EBO Sales' },
      keyKind: 'secret',
      contractVersion: INGEST_CONTRACT_VERSION,
      serverTime: FIXED_NOW.toISOString(),
    });
  });
});

// ─── Browser ingest ─────────────────────────────────────────────────────────

/** In-memory web_events: ON CONFLICT DO NOTHING semantics, injectable failures. */
class FakeWebEvents implements Pick<WebEventIngestRepository, 'insertBatch'> {
  stored = new Set<string>();
  poisonEventIds = new Set<string>();
  missingPartitionFailures = 0;
  failWith: unknown = null;
  insertBatch = vi.fn(async (rows: WebEventInsert[]): Promise<string[]> => {
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

class FakeBrowserLiveFeed implements Pick<LiveFeed, 'recordWebEvents'> {
  recordWebEvents = vi.fn((_app: AppRow, _rows: readonly WebEventInsert[]) => undefined);
}

function browserEnvelope(
  events: unknown[],
  extra: Partial<BrowserIngestEnvelope> = {},
): BrowserIngestEnvelope {
  return {
    key: 'nx_pk_x',
    sentAt: '2026-10-01T09:59:59.000Z',
    sessionId: '33333333-3333-4333-8333-333333333333',
    events,
    ...extra,
  };
}

describe('IngestService.ingestBrowserEvents', () => {
  let webEvents: FakeWebEvents;
  let counters: FakeCounters;
  let partitions: FakePartitions;
  let liveFeed: FakeBrowserLiveFeed;
  let rejections: FakeRejections;
  let piiDetections: FakePiiDetections;
  let ssoOutcomes: FakeSsoOutcomes;
  let service: IngestService;
  const ctx = browserIngestContext();

  beforeEach(() => {
    webEvents = new FakeWebEvents();
    counters = new FakeCounters();
    partitions = new FakePartitions();
    liveFeed = new FakeBrowserLiveFeed();
    rejections = new FakeRejections();
    piiDetections = new FakePiiDetections();
    ssoOutcomes = new FakeSsoOutcomes();
    service = buildService({ webEvents, counters, rejections, piiDetections, ssoOutcomes, partitions, liveFeed });
  });

  const ingest = (events: unknown[], extra: Partial<BrowserIngestEnvelope> = {}) =>
    service.ingestBrowserEvents(browserEnvelope(events, extra), ctx);

  it('stores every event type into web_events, counts as browser and publishes live', async () => {
    const pageViewId = randomUUID();
    const events = [
      browserEvent({ eventId: pageViewId }),
      browserEvent({
        type: 'page_time',
        pageViewId,
        visibleMs: 900,
        final: false,
        reason: 'hidden',
        seq: 1,
      }),
      browserEvent({ type: 'tool_use', tool: 'stores.export', seq: 2 }),
      browserEvent({ type: 'custom', name: 'report.opened', seq: 3 }),
    ];
    const result = await ingest(events);

    expect(result).toEqual({ accepted: 4, duplicates: 0, rejected: [], warnings: [] });
    const [rows] = webEvents.insertBatch.mock.calls[0]!;
    expect(rows.map((r) => r.eventType)).toEqual(['page_view', 'page_time', 'tool_use', 'custom']);
    expect(rows[0]).toMatchObject({
      appId: ctx.app.id,
      sessionId: '33333333-3333-4333-8333-333333333333',
    });
    expect(rows[0]?.clockSkewMs).toBe(1000);
    expect(counters.increment).toHaveBeenCalledWith(
      {
        appId: ctx.app.id,
        source: 'browser',
        accepted: 4,
        duplicates: 0,
        rejected: 0,
        rateLimited: 0,
      },
      FIXED_NOW,
    );
    expect(liveFeed.recordWebEvents).toHaveBeenCalledWith(ctx.app, rows);
  });

  it('rejects invalid, out-of-window and outside-the-base-path events with their indexes', async () => {
    const result = await ingest([
      browserEvent(),
      browserEvent({ type: 'tool_use', tool: 'NOT VALID' }),
      browserEvent({ occurredAt: '2026-09-20T00:00:00.000Z' }),
      browserEvent({ path: '/other-app/page' }),
      browserEvent({ path: '/ebo-sales-admin' }),
    ]);

    expect(result.accepted).toBe(1);
    expect(result.rejected.map((r) => [r.index, r.code])).toEqual([
      [1, ERROR_CODES.INVALID_EVENT],
      [2, ERROR_CODES.EVENT_TIME_OUT_OF_RANGE],
      [3, ERROR_CODES.PATH_OUTSIDE_APP],
      [4, ERROR_CODES.PATH_OUTSIDE_APP],
    ]);
    expect(result.rejected[2]?.message).not.toContain('/other-app');
    expect(counters.increment.mock.calls[0]?.[0]).toMatchObject({
      source: 'browser',
      accepted: 1,
      rejected: 4,
    });
  });

  it('a claimed hint fills claimed_email only; an implausible one warns once, on the first stored event', async () => {
    const claimed = await ingest([browserEvent(), browserEvent()], {
      user: { email: 'Someone@Libas.in' },
    });
    expect(claimed.warnings).toEqual([]);
    const [rows] = webEvents.insertBatch.mock.calls[0]!;
    expect(rows[0]).toMatchObject({
      identitySource: 'client_claimed',
      claimedEmail: 'someone@libas.in',
      userEmail: null,
      userKey: null,
    });

    const dropped = await ingest([{ bad: true }, browserEvent(), browserEvent()], {
      user: { email: 'nope' },
    });
    expect(dropped.warnings).toEqual([
      { index: 1, code: ERROR_CODES.FIELD_DROPPED, field: 'user.email' },
    ]);
  });

  it('counts in-batch and DB duplicates and keeps them off the live feed', async () => {
    const known = browserEvent();
    webEvents.stored.add(known.eventId);
    const fresh = browserEvent();
    const result = await ingest([known, fresh, { ...fresh }]);

    expect(result).toMatchObject({ accepted: 1, duplicates: 2 });
    const [, liveRows] = liveFeed.recordWebEvents.mock.calls[0]!;
    expect(liveRows.map((r) => r.eventId)).toEqual([fresh.eventId]);
  });

  it('creates missing partitions and retries the insert once', async () => {
    webEvents.missingPartitionFailures = 1;
    const result = await ingest([browserEvent()]);
    expect(result.accepted).toBe(1);
    expect(partitions.ensure).toHaveBeenCalledWith(PARTITION_MONTHS_BACK, PARTITION_MONTHS_AHEAD);
    expect(webEvents.insertBatch).toHaveBeenCalledTimes(2);
  });

  it('bisects and rejects only the poison rows as DB_CONSTRAINT', async () => {
    const events = Array.from({ length: 5 }, () => browserEvent());
    webEvents.poisonEventIds.add(events[3]!.eventId.toLowerCase());
    const result = await ingest(events);
    expect(result.accepted).toBe(4);
    expect(result.rejected.map((r) => [r.index, r.code])).toEqual([[3, ERROR_CODES.DB_CONSTRAINT]]);
  });

  it('DB unavailable → 503 INGEST_UNAVAILABLE, nothing counted', async () => {
    webEvents.failWith = POOL_TIMEOUT;
    await expect(ingest([browserEvent()])).rejects.toMatchObject({
      statusCode: 503,
      code: ERROR_CODES.INGEST_UNAVAILABLE,
    });
    expect(counters.increment).not.toHaveBeenCalled();
  });
});

// ─── Diagnostics recorded after commit (A3, A4, A8, A9) ─────────────────────

describe('IngestService server diagnostics', () => {
  let apiRequests: FakeApiRequests;
  let rejections: FakeRejections;
  let piiDetections: FakePiiDetections;
  let logger: Logger;
  let service: IngestService;

  beforeEach(() => {
    apiRequests = new FakeApiRequests();
    rejections = new FakeRejections();
    piiDetections = new FakePiiDetections();
    logger = silentLogger();
    service = buildService({ apiRequests, rejections, piiDetections, liveFeed: new FakeLiveFeed(), logger });
  });

  const ingest = (events: unknown[], ctxOverrides: Parameters<typeof ingestContext>[0] = {}, dryRun = false) =>
    service.ingestServerEvents(envelope(events), ingestContext(ctxOverrides), { dryRun });

  it('records reject reasons as code + normalised schema path + strict sdk, never the message', async () => {
    const poison = serverEvent();
    apiRequests.poisonEventIds.add(poison.eventId);
    await ingest(
      [
        { ...serverEvent(), status: 99 },
        { ...serverEvent(), status: 1 },
        { ...serverEvent(), method: 'SECRET-VALUE' },
        serverEvent({ occurredAt: '2026-09-20T00:00:00.000Z' }),
        poison,
      ],
      { sdk: '@nexus/express@1.1.0' },
    );
    expect(rejections.increment).toHaveBeenCalledTimes(1);
    const [appId, rows, at] = rejections.increment.mock.calls[0]!;
    expect(appId).toBe(ingestContext().app.id);
    expect(at).toEqual(FIXED_NOW);
    const sdk = '@nexus/express@1.1.0';
    expect(rows).toEqual([
      { source: 'server', sdk, code: 'INVALID_EVENT', schemaPath: 'status', rejected: 2 },
      { source: 'server', sdk, code: 'INVALID_EVENT', schemaPath: 'method', rejected: 1 },
      { source: 'server', sdk, code: 'EVENT_TIME_OUT_OF_RANGE', schemaPath: 'occurredAt', rejected: 1 },
      { source: 'server', sdk, code: 'DB_CONSTRAINT', schemaPath: 'api_requests_path_check', rejected: 1 },
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/SECRET|expected|violates/);
  });

  it('a 300-char sdk label becomes "" (the upsert can never break its CHECK)', async () => {
    await ingest([{ ...serverEvent(), status: 99 }], { sdk: 'x'.repeat(300) });
    expect(rejections.increment.mock.calls[0]![1]).toEqual([
      { source: 'server', sdk: '', code: 'INVALID_EVENT', schemaPath: 'status', rejected: 1 },
    ]);
  });

  it('dryRun records no reasons and no PII', async () => {
    await ingest([{ ...serverEvent(), status: 99 }, serverEvent({ path: '/c/9876543210' })], {}, true);
    expect(rejections.increment).not.toHaveBeenCalled();
    expect(piiDetections.increment).not.toHaveBeenCalled();
  });

  it('counts PII detections of STORED events only (a duplicate is not counted twice)', async () => {
    const leaky = serverEvent({ path: '/ebo-sales/customers/9876543210' });
    const result = await ingest([leaky, { ...leaky }, serverEvent()]);
    // Warnings describe every SENT event (the copy too); the counter counts stored ones only.
    expect(result.warnings).toEqual([
      { index: 0, code: ERROR_CODES.FIELD_REDACTED, field: 'path' },
      { index: 1, code: ERROR_CODES.FIELD_REDACTED, field: 'path' },
    ]);
    expect(piiDetections.increment).toHaveBeenCalledWith(
      ingestContext().app.id,
      'server',
      [{ field: 'path', kind: 'phone', detections: 1 }],
      FIXED_NOW,
    );
    const [rows] = apiRequests.insertBatch.mock.calls[0]!;
    expect(rows[0]?.path).toBe('/ebo-sales/customers/:phone');
  });

  it('no detections → no PII write; no rejections → no reasons write', async () => {
    await ingest([serverEvent()]);
    expect(piiDetections.increment).not.toHaveBeenCalled();
    expect(rejections.increment).not.toHaveBeenCalled();
  });

  it('stores the claimed environment; an unknown claim warns on the first stored event', async () => {
    await ingest([serverEvent()], { environmentClaim: 'staging' });
    expect(apiRequests.insertBatch.mock.calls[0]![0][0]?.environment).toBe('staging');

    const result = await ingest([{ bad: true }, serverEvent()], { environmentClaim: 'qa' });
    expect(result.warnings).toEqual([{ index: 1, code: ERROR_CODES.FIELD_DROPPED, field: 'environment' }]);
    expect(apiRequests.insertBatch.mock.calls[1]![0][0]?.environment).toBe('prod');
  });

  it('a rejection / PII counter failure is logged and never fails the request', async () => {
    rejections.increment.mockRejectedValueOnce(new Error('down'));
    piiDetections.increment.mockRejectedValueOnce(new Error('down'));
    const warn = vi.spyOn(logger, 'warn');
    await expect(
      ingest([{ ...serverEvent(), status: 99 }, serverEvent({ path: '/c/9876543210' })]),
    ).resolves.toMatchObject({ accepted: 1 });
    expect(warn).toHaveBeenCalledWith('ingest rejection counter update failed', expect.anything());
    expect(warn).toHaveBeenCalledWith('pii detection counter update failed', expect.anything());
  });
});

describe('IngestService browser diagnostics', () => {
  let webEvents: FakeWebEvents;
  let rejections: FakeRejections;
  let ssoOutcomes: FakeSsoOutcomes;
  let service: IngestService;

  beforeEach(() => {
    webEvents = new FakeWebEvents();
    rejections = new FakeRejections();
    ssoOutcomes = new FakeSsoOutcomes();
    service = buildService({ webEvents, rejections, ssoOutcomes, liveFeed: new FakeBrowserLiveFeed() });
  });

  const ingest = (events: unknown[], ctx = browserIngestContext()) =>
    service.ingestBrowserEvents(browserEnvelope(events), ctx);

  it('records the SSO cookie outcome once per beacon with the beacon origin', async () => {
    await ingest([browserEvent(), browserEvent()]);
    expect(ssoOutcomes.increment).toHaveBeenCalledTimes(1);
    expect(ssoOutcomes.increment).toHaveBeenCalledWith(
      browserIngestContext().app.id,
      'no-cookie',
      'cross_origin',
      FIXED_NOW,
    );
  });

  it.each([
    [PUBLIC_ORIGIN, 'same_origin'],
    [`${PUBLIC_ORIGIN.toUpperCase()}/`, 'same_origin'],
    [null, 'none'],
  ] as const)('origin %s → %s', async (origin, beaconOrigin) => {
    const base = browserIngestContext();
    await ingest([browserEvent()], { ...base, request: { ...base.request, origin } });
    expect(ssoOutcomes.increment.mock.calls[0]?.[2]).toBe(beaconOrigin);
  });

  it('a replay records no SSO outcome', async () => {
    await ingest([browserEvent()], browserIngestContext({ envelope: { replay: true } }));
    expect(ssoOutcomes.increment).not.toHaveBeenCalled();
  });

  it('records browser reject reasons with the beacon sdk (PATH_OUTSIDE_APP → path)', async () => {
    await ingest(
      [browserEvent({ path: '/other-app/x' }), browserEvent({ type: 'tool_use', tool: 'NOT VALID' })],
      browserIngestContext({ sdk: '@nexus/react@1.1.0' }),
    );
    const sdk = '@nexus/react@1.1.0';
    expect(rejections.increment.mock.calls[0]![1]).toEqual([
      { source: 'browser', sdk, code: 'PATH_OUTSIDE_APP', schemaPath: 'path', rejected: 1 },
      { source: 'browser', sdk, code: 'INVALID_EVENT', schemaPath: 'tool', rejected: 1 },
    ]);
  });

  it('stores envelope columns; a loopback origin is always dev', async () => {
    const base = browserIngestContext({
      environmentClaim: 'prod',
      envelope: { tz: 'Asia/Kolkata', lang: 'en-IN', release: '2026.11.18-a1b2c3d', replay: false },
    });
    await ingest([browserEvent()], { ...base, request: { ...base.request, origin: 'http://localhost:5173' } });
    expect(webEvents.insertBatch.mock.calls[0]![0][0]).toMatchObject({
      environment: 'dev',
      clientTz: 'Asia/Kolkata',
      clientLang: 'en-IN',
      release: '2026.11.18-a1b2c3d',
    });
  });
});

describe('IngestService.config', () => {
  it('returns the app remote config', () => {
    const config = buildService().config(browserIngestContext().app);
    expect(config).toMatchObject({ contract: INGEST_CONTRACT_VERSION, version: 1, enabled: true, disabledModules: [] });
  });
});
