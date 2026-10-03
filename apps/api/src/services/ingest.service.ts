/**
 * Ingest use cases (synchronous: a 202 means the rows are committed).
 *
 * ingestServerEvents:
 *   per event: serverEventSchema.safeParse → EventTimeGuard → ServerEventEnricher (→ warnings)
 *   → in-batch dedupe by eventId (later copies count as duplicates)
 *   → ApiRequestIngestRepository.insertBatch (unless dryRun)
 *       · isMissingPartition → PartitionRepository.ensure(1, 2) and retry ONCE
 *       · isDataError → bisect the batch, reject only the poison rows (DB_CONSTRAINT, with index)
 *       · isUnavailable (or a partition still missing after the retry) → 503 INGEST_UNAVAILABLE
 *   → IngestCounterRepository.increment (failures logged, never fail the request)
 *   → LiveFeed.recordApiRequests(inserted rows only)
 *   → IngestResultDto { accepted, duplicates, rejected[], warnings[] }
 * dryRun: validation + enrichment only — no insert, no counters, no live feed.
 *
 * ingestBrowserEvents (same storage path, web_events instead of api_requests, no dryRun):
 *   BrowserEventEnricher.enrichActor ONCE per beacon (identity, IP, geo, user agent)
 *   per event: browserEventSchema.safeParse → EventTimeGuard → base-path rule (PATH_OUTSIDE_APP)
 *   → BrowserEventEnricher.enrich → dedupe → WebEventIngestRepository.insertBatch (partition retry,
 *   bisect, 503) → counters (source 'browser') → LiveFeed.recordWebEvents.
 * Key usage (last_used_at) is recorded by AppKeyAuthenticator, not here.
 * @see ../repositories/api-request-ingest.repository.ts ApiRequestIngestRepository.insertBatch
 * @see ../repositories/web-event-ingest.repository.ts WebEventIngestRepository.insertBatch
 * @see ../repositories/partition.repository.ts PartitionRepository.ensure
 * @see ../repositories/ingest-counter.repository.ts IngestCounterRepository.increment
 */
import {
  browserEventSchema,
  ERROR_CODES,
  INGEST_CONTRACT_VERSION,
  serverEventSchema,
  type BrowserIngestEnvelope,
  type IngestEventRejectCode,
  type IngestRejection,
  type IngestResultDto,
  type IngestSource,
  type IngestWarning,
  type ServerIngestEnvelope,
  type VerifyResponseDto,
} from '@nexus/shared';
import type { z } from 'zod';

import { isDataError, isMissingPartition, isUnavailable } from '../db/pg-errors';
import { isWithinBasePath } from '../domain/base-path';
import type { ApiRequestInsert, WebEventInsert } from '../domain/inserts';
import type { BrowserIngestContext, IngestContext } from '../domain/viewer';
import type { BrowserEventEnricher } from '../enrichment/browser-event.enricher';
import type { EventTimeGuard } from '../enrichment/event-time.guard';
import type { ServerEventEnricher } from '../enrichment/server-event.enricher';
import { ServiceUnavailableError } from '../errors/app-error';
import type { Logger } from '../lib/logger';
import type { LiveFeed } from '../live/live-feed';
import type { ApiRequestIngestRepository } from '../repositories/api-request-ingest.repository';
import type { IngestCounterRepository } from '../repositories/ingest-counter.repository';
import type { PartitionRepository } from '../repositories/partition.repository';
import type { WebEventIngestRepository } from '../repositories/web-event-ingest.repository';
import { PARTITION_MONTHS_AHEAD, PARTITION_MONTHS_BACK } from './partition.service';

export interface IngestOptions {
  dryRun: boolean;
}

/** Any insert row of an event table (both are keyed by a lower-cased eventId). */
interface EventRow {
  eventId: string;
}

/** A valid, enriched event remembered with its ORIGINAL position in envelope.events. */
interface Candidate<R extends EventRow = ApiRequestInsert> {
  index: number;
  row: R;
}

interface PreparedBatch<R extends EventRow = ApiRequestInsert> {
  candidates: Candidate<R>[];
  rejected: IngestRejection[];
  warnings: IngestWarning[];
}

interface InsertOutcome<R extends EventRow> {
  insertedIds: string[];
  poison: Candidate<R>[];
}

/** Stored outcome of one batch: the IngestResultDto plus the rows that were really inserted. */
interface StoredBatch<R extends EventRow> {
  result: IngestResultDto;
  inserted: Candidate<R>[];
}

/** The repository call of one event table (ApiRequestIngestRepository / WebEventIngestRepository). */
type InsertRows<R extends EventRow> = (rows: R[]) => Promise<string[]>;

const MESSAGES = {
  outOfWindow: 'occurredAt is outside the accepted window (received - 7 days .. received + 5 minutes)',
  outsideApp: "path is outside the app's base path",
  dbConstraint: 'Rejected by a database constraint',
  unavailable: 'Ingest temporarily unavailable',
} as const;

/** Short, value-free description of the first zod issue, e.g. "status: Too big: expected …". */
function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid event';
  const path = issue.path.length > 0 ? issue.path.join('.') : 'event';
  return `${path}: ${issue.message}`;
}

function reject(index: number, code: IngestEventRejectCode, message: string): IngestRejection {
  return { index, code, message };
}

/** First occurrence of each eventId wins; later copies are in-batch duplicates. */
function dedupe<R extends EventRow>(candidates: Candidate<R>[]): { unique: Candidate<R>[]; duplicates: number } {
  const seen = new Set<string>();
  const unique = candidates.filter((candidate) => {
    if (seen.has(candidate.row.eventId)) return false;
    seen.add(candidate.row.eventId);
    return true;
  });
  return { unique, duplicates: candidates.length - unique.length };
}

const byIndex = (a: { index: number }, b: { index: number }) => a.index - b.index;

/** WHY: the one use case behind ROUTES.ingest.* — validate, enrich, store, report. */
export class IngestService {
  constructor(
    private readonly apiRequests: ApiRequestIngestRepository,
    private readonly webEvents: WebEventIngestRepository,
    private readonly counters: IngestCounterRepository,
    private readonly partitions: PartitionRepository,
    private readonly serverEnricher: ServerEventEnricher,
    private readonly browserEnricher: BrowserEventEnricher,
    private readonly timeGuard: EventTimeGuard,
    private readonly liveFeed: LiveFeed,
    private readonly logger: Logger,
  ) {}

  async ingestServerEvents(
    envelope: ServerIngestEnvelope,
    ctx: IngestContext,
    options: IngestOptions,
  ): Promise<IngestResultDto> {
    const batch = this.prepare(envelope, ctx);
    if (options.dryRun) {
      return {
        accepted: batch.candidates.length,
        duplicates: 0,
        rejected: batch.rejected,
        warnings: batch.warnings,
        dryRun: true,
      };
    }
    const { result, inserted } = await this.storeBatch(batch, (rows) => this.apiRequests.insertBatch(rows));
    await this.count(ctx, 'server', result);
    this.publishLive(ctx, inserted, (rows) => this.liveFeed.recordApiRequests(ctx.app, rows));
    return result;
  }

  /** POST ROUTES.ingest.browser (publishable key; origin and session limits checked by middleware). */
  async ingestBrowserEvents(envelope: BrowserIngestEnvelope, ctx: BrowserIngestContext): Promise<IngestResultDto> {
    const batch = this.prepareBrowser(envelope, ctx);
    const { result, inserted } = await this.storeBatch(batch, (rows) => this.webEvents.insertBatch(rows));
    await this.count(ctx, 'browser', result);
    this.publishLive(ctx, inserted, (rows) => this.liveFeed.recordWebEvents(ctx.app, rows));
    return result;
  }

  verify(ctx: IngestContext): VerifyResponseDto {
    return {
      app: { slug: ctx.app.slug, displayName: ctx.app.display_name },
      keyKind: ctx.key.kind,
      contractVersion: INGEST_CONTRACT_VERSION,
      serverTime: ctx.receivedAt.toISOString(),
    };
  }

  // ─── Validation + enrichment ──────────────────────────────────────────────

  private prepare(envelope: ServerIngestEnvelope, ctx: IngestContext): PreparedBatch {
    const skew = this.timeGuard.skewMs(envelope.sentAt, ctx.receivedAt);
    const batch: PreparedBatch = { candidates: [], rejected: [], warnings: [] };
    envelope.events.forEach((raw, index) => {
      const parsed = serverEventSchema.safeParse(raw);
      if (!parsed.success) {
        batch.rejected.push(reject(index, ERROR_CODES.INVALID_EVENT, describeIssue(parsed.error)));
        return;
      }
      if (!this.timeGuard.isAcceptable(new Date(parsed.data.occurredAt), ctx.receivedAt)) {
        batch.rejected.push(reject(index, ERROR_CODES.EVENT_TIME_OUT_OF_RANGE, MESSAGES.outOfWindow));
        return;
      }
      const enriched = this.serverEnricher.enrich(parsed.data, ctx, skew);
      batch.candidates.push({ index, row: enriched.row });
      for (const warning of enriched.warnings) batch.warnings.push({ index, ...warning });
    });
    return batch;
  }

  private prepareBrowser(envelope: BrowserIngestEnvelope, ctx: BrowserIngestContext): PreparedBatch<WebEventInsert> {
    const skew = this.timeGuard.skewMs(envelope.sentAt, ctx.receivedAt);
    const { actor, warnings: actorWarnings } = this.browserEnricher.enrichActor(envelope, ctx);
    const batch: PreparedBatch<WebEventInsert> = { candidates: [], rejected: [], warnings: [] };
    envelope.events.forEach((raw, index) => {
      const parsed = browserEventSchema.safeParse(raw);
      if (!parsed.success) {
        batch.rejected.push(reject(index, ERROR_CODES.INVALID_EVENT, describeIssue(parsed.error)));
        return;
      }
      if (!this.timeGuard.isAcceptable(new Date(parsed.data.occurredAt), ctx.receivedAt)) {
        batch.rejected.push(reject(index, ERROR_CODES.EVENT_TIME_OUT_OF_RANGE, MESSAGES.outOfWindow));
        return;
      }
      if (!isWithinBasePath(parsed.data.path, ctx.app.base_path)) {
        batch.rejected.push(reject(index, ERROR_CODES.PATH_OUTSIDE_APP, MESSAGES.outsideApp));
        return;
      }
      const enriched = this.browserEnricher.enrich(parsed.data, envelope, ctx, actor, skew);
      batch.candidates.push({ index, row: enriched.row });
      for (const warning of enriched.warnings) batch.warnings.push({ index, ...warning });
    });
    // Envelope-level warnings (e.g. the user.email hint) are reported once, on the first stored event.
    const first = batch.candidates[0];
    if (first) batch.warnings.unshift(...actorWarnings.map((warning) => ({ index: first.index, ...warning })));
    return batch;
  }

  // ─── Storage (dedupe, partition retry, poison-row bisect, availability) ───

  private async storeBatch<R extends EventRow>(batch: PreparedBatch<R>, insert: InsertRows<R>): Promise<StoredBatch<R>> {
    const { unique, duplicates: inBatchDuplicates } = dedupe(batch.candidates);
    const outcome = await this.store(unique, insert);
    const insertedIds = new Set(outcome.insertedIds.map((id) => id.toLowerCase()));
    const inserted = unique.filter((candidate) => insertedIds.has(candidate.row.eventId));
    const dbDuplicates = unique.length - outcome.poison.length - inserted.length;
    const rejected = [
      ...batch.rejected,
      ...outcome.poison.map((c) => reject(c.index, ERROR_CODES.DB_CONSTRAINT, MESSAGES.dbConstraint)),
    ].sort(byIndex);
    const result: IngestResultDto = {
      accepted: inserted.length,
      duplicates: inBatchDuplicates + dbDuplicates,
      rejected,
      warnings: batch.warnings,
    };
    return { result, inserted };
  }

  private async store<R extends EventRow>(candidates: Candidate<R>[], insert: InsertRows<R>): Promise<InsertOutcome<R>> {
    try {
      return await this.insertOrBisect(candidates, insert);
    } catch (err) {
      if (isUnavailable(err) || isMissingPartition(err)) {
        this.logger.warn('ingest insert unavailable', { err });
        throw new ServiceUnavailableError(MESSAGES.unavailable, ERROR_CODES.INGEST_UNAVAILABLE);
      }
      throw err;
    }
  }

  /** Inserts the slice; on a data error splits it in halves until each poison row is isolated. */
  private async insertOrBisect<R extends EventRow>(
    candidates: Candidate<R>[],
    insert: InsertRows<R>,
  ): Promise<InsertOutcome<R>> {
    if (candidates.length === 0) return { insertedIds: [], poison: [] };
    try {
      return { insertedIds: await this.insertWithPartitionRetry(candidates, insert), poison: [] };
    } catch (err) {
      if (!isDataError(err)) throw err;
      if (candidates.length === 1) return { insertedIds: [], poison: candidates };
      const middle = Math.ceil(candidates.length / 2);
      const left = await this.insertOrBisect(candidates.slice(0, middle), insert);
      const right = await this.insertOrBisect(candidates.slice(middle), insert);
      return {
        insertedIds: [...left.insertedIds, ...right.insertedIds],
        poison: [...left.poison, ...right.poison],
      };
    }
  }

  private async insertWithPartitionRetry<R extends EventRow>(
    candidates: Candidate<R>[],
    insert: InsertRows<R>,
  ): Promise<string[]> {
    const rows = candidates.map((candidate) => candidate.row);
    try {
      return await insert(rows);
    } catch (err) {
      if (!isMissingPartition(err)) throw err;
      this.logger.warn('missing partition on ingest; ensuring partitions and retrying once');
      await this.partitions.ensure(PARTITION_MONTHS_BACK, PARTITION_MONTHS_AHEAD);
      return insert(rows);
    }
  }

  // ─── Side effects after commit (never fail the request) ───────────────────

  private async count(ctx: IngestContext, source: IngestSource, result: IngestResultDto): Promise<void> {
    try {
      await this.counters.increment(
        {
          appId: ctx.app.id,
          source,
          accepted: result.accepted,
          duplicates: result.duplicates,
          rejected: result.rejected.length,
          rateLimited: 0,
        },
        ctx.receivedAt,
      );
    } catch (err) {
      this.logger.warn('ingest counter update failed', { err, appId: ctx.app.id });
    }
  }

  /** Hands ONLY the really inserted rows to `record` (a LiveFeed method); skipped when there are none. */
  private publishLive<R extends EventRow>(ctx: IngestContext, inserted: Candidate<R>[], record: (rows: R[]) => void): void {
    if (inserted.length === 0) return;
    try {
      record(inserted.map((candidate) => candidate.row));
    } catch (err) {
      this.logger.warn('live feed update failed', { err, appId: ctx.app.id });
    }
  }
}
