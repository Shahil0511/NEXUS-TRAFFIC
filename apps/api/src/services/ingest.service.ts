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
 * Key usage (last_used_at) is recorded by AppKeyAuthenticator, not here.
 * @see ../repositories/api-request-ingest.repository.ts ApiRequestIngestRepository.insertBatch
 * @see ../repositories/partition.repository.ts PartitionRepository.ensure
 * @see ../repositories/ingest-counter.repository.ts IngestCounterRepository.increment
 */
import {
  ERROR_CODES,
  INGEST_CONTRACT_VERSION,
  serverEventSchema,
  type IngestEventRejectCode,
  type IngestRejection,
  type IngestResultDto,
  type IngestWarning,
  type ServerIngestEnvelope,
  type VerifyResponseDto,
} from '@nexus/shared';
import type { z } from 'zod';

import { isDataError, isMissingPartition, isUnavailable } from '../db/pg-errors';
import type { ApiRequestInsert } from '../domain/inserts';
import type { IngestContext } from '../domain/viewer';
import type { EventTimeGuard } from '../enrichment/event-time.guard';
import type { ServerEventEnricher } from '../enrichment/server-event.enricher';
import { ServiceUnavailableError } from '../errors/app-error';
import type { Logger } from '../lib/logger';
import type { LiveFeed } from '../live/live-feed';
import type { ApiRequestIngestRepository } from '../repositories/api-request-ingest.repository';
import type { IngestCounterRepository } from '../repositories/ingest-counter.repository';
import type { PartitionRepository } from '../repositories/partition.repository';
import { PARTITION_MONTHS_AHEAD, PARTITION_MONTHS_BACK } from './partition.service';

export interface IngestOptions {
  dryRun: boolean;
}

/** A valid, enriched event remembered with its ORIGINAL position in envelope.events. */
interface Candidate {
  index: number;
  row: ApiRequestInsert;
}

interface PreparedBatch {
  candidates: Candidate[];
  rejected: IngestRejection[];
  warnings: IngestWarning[];
}

interface InsertOutcome {
  insertedIds: string[];
  poison: Candidate[];
}

const MESSAGES = {
  outOfWindow: 'occurredAt is outside the accepted window (received - 7 days .. received + 5 minutes)',
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
function dedupe(candidates: Candidate[]): { unique: Candidate[]; duplicates: number } {
  const seen = new Set<string>();
  const unique = candidates.filter((candidate) => {
    if (seen.has(candidate.row.eventId)) return false;
    seen.add(candidate.row.eventId);
    return true;
  });
  return { unique, duplicates: candidates.length - unique.length };
}

const byIndex = (a: { index: number }, b: { index: number }) => a.index - b.index;

/** WHY: the one use case behind ROUTES.ingest.server/verify — validate, enrich, store, report. */
export class IngestService {
  constructor(
    private readonly apiRequests: ApiRequestIngestRepository,
    private readonly counters: IngestCounterRepository,
    private readonly partitions: PartitionRepository,
    private readonly serverEnricher: ServerEventEnricher,
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
    const { unique, duplicates: inBatchDuplicates } = dedupe(batch.candidates);
    const outcome = await this.store(unique);
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
    await this.countServer(ctx, result);
    this.publishLive(ctx, inserted);
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

  // ─── Storage (partition retry, poison-row bisect, availability) ───────────

  private async store(candidates: Candidate[]): Promise<InsertOutcome> {
    try {
      return await this.insertOrBisect(candidates);
    } catch (err) {
      if (isUnavailable(err) || isMissingPartition(err)) {
        this.logger.warn('ingest insert unavailable', { err });
        throw new ServiceUnavailableError(MESSAGES.unavailable, ERROR_CODES.INGEST_UNAVAILABLE);
      }
      throw err;
    }
  }

  /** Inserts the slice; on a data error splits it in halves until each poison row is isolated. */
  private async insertOrBisect(candidates: Candidate[]): Promise<InsertOutcome> {
    if (candidates.length === 0) return { insertedIds: [], poison: [] };
    try {
      return { insertedIds: await this.insertWithPartitionRetry(candidates), poison: [] };
    } catch (err) {
      if (!isDataError(err)) throw err;
      if (candidates.length === 1) return { insertedIds: [], poison: candidates };
      const middle = Math.ceil(candidates.length / 2);
      const left = await this.insertOrBisect(candidates.slice(0, middle));
      const right = await this.insertOrBisect(candidates.slice(middle));
      return {
        insertedIds: [...left.insertedIds, ...right.insertedIds],
        poison: [...left.poison, ...right.poison],
      };
    }
  }

  private async insertWithPartitionRetry(candidates: Candidate[]): Promise<string[]> {
    const rows = candidates.map((candidate) => candidate.row);
    try {
      return await this.apiRequests.insertBatch(rows);
    } catch (err) {
      if (!isMissingPartition(err)) throw err;
      this.logger.warn('missing partition on ingest; ensuring partitions and retrying once');
      await this.partitions.ensure(PARTITION_MONTHS_BACK, PARTITION_MONTHS_AHEAD);
      return this.apiRequests.insertBatch(rows);
    }
  }

  // ─── Side effects after commit (never fail the request) ───────────────────

  private async countServer(ctx: IngestContext, result: IngestResultDto): Promise<void> {
    try {
      await this.counters.increment(
        {
          appId: ctx.app.id,
          source: 'server',
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

  private publishLive(ctx: IngestContext, inserted: Candidate[]): void {
    if (inserted.length === 0) return;
    try {
      this.liveFeed.recordApiRequests(
        ctx.app,
        inserted.map((candidate) => candidate.row),
      );
    } catch (err) {
      this.logger.warn('live feed update failed', { err, appId: ctx.app.id });
    }
  }
}
