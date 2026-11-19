/**
 * Ingest use cases (synchronous: a 202 means the rows are committed).
 *
 * ingestServerEvents:
 *   ServerEventEnricher.enrichEnvelope ONCE (environment; ADR 0008)
 *   per event: serverEventSchema.safeParse → EventTimeGuard → ServerEventEnricher (→ warnings, PII)
 *   → in-batch dedupe by eventId (later copies count as duplicates)
 *   → ApiRequestIngestRepository.insertBatch (unless dryRun)
 *       · isMissingPartition → PartitionRepository.ensure(1, 2) and retry ONCE
 *       · isDataError → bisect the batch, reject only the poison rows (DB_CONSTRAINT, with index)
 *       · isUnavailable (or a partition still missing after the retry) → 503 INGEST_UNAVAILABLE
 *   → after commit, each step on its own (failures logged, never fail the request):
 *       IngestCounterRepository.increment · IngestRejectionRepository.increment (reasons, A9) ·
 *       PiiDetectionRepository.increment (A8) · LiveFeed.recordApiRequests(inserted rows only)
 *   → IngestResultDto { accepted, duplicates, rejected[], warnings[] }
 * dryRun: validation + enrichment only — no insert, no counters, no live feed.
 *
 * ingestBrowserEvents (same storage path, web_events instead of api_requests, no dryRun):
 *   BrowserEventEnricher.enrichActor ONCE per beacon (identity, IP, geo, user agent, environment,
 *   tz/lang/release) → per event: browserEventSchema.safeParse → EventTimeGuard → base-path rule
 *   (PATH_OUTSIDE_APP) → BrowserEventEnricher.enrich → dedupe → WebEventIngestRepository.insertBatch
 *   (partition retry, bisect, 503) → counters, rejections, PII (source 'browser') and the SSO
 *   cookie outcome of the beacon (SsoCookieOutcomeRepository, skipped for replays) →
 *   LiveFeed.recordWebEvents.
 *
 * config (POST ROUTES.ingest.config): the app's SdkRemoteConfig (no I/O; it rides AppKeyCache).
 * Key usage (last_used_at) is recorded by AppKeyAuthenticator, not here.
 * Rejection reasons are stored as codes + normalised schema paths, NEVER messages (CLAUDE.md rule 6).
 * @see ../repositories/api-request-ingest.repository.ts ApiRequestIngestRepository.insertBatch
 * @see ../repositories/web-event-ingest.repository.ts WebEventIngestRepository.insertBatch
 * @see ../repositories/partition.repository.ts PartitionRepository.ensure
 * @see ../repositories/ingest-counter.repository.ts IngestCounterRepository.increment
 * @see ../repositories/ingest-rejection.repository.ts IngestRejectionRepository.increment
 * @see ../repositories/pii-detection.repository.ts PiiDetectionRepository.increment
 * @see ../repositories/sso-cookie-outcome.repository.ts SsoCookieOutcomeRepository.increment
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
  type SdkRemoteConfig,
  type ServerIngestEnvelope,
  type SsoCookieOutcome,
  type VerifyResponseDto,
} from '@nexus/shared';
import type { z } from 'zod';

import { isDataError, isMissingPartition, isUnavailable } from '../db/pg-errors';
import { isWithinBasePath } from '../domain/base-path';
import { beaconOriginOf, toPiiIncrements, toRejectionIncrements } from '../domain/ingest-diagnostics';
import type { ApiRequestInsert, WebEventInsert } from '../domain/inserts';
import type { AppRow } from '../domain/rows';
import { FIXED_SCHEMA_PATHS, NO_SCHEMA_PATH, normalizeSchemaPath, schemaPathOfConstraint } from '../domain/schema-path';
import { toSdkRemoteConfig } from '../domain/sdk-config';
import { normalizeSdkLabel } from '../domain/sdk-label';
import type { BrowserIngestContext, IngestContext } from '../domain/viewer';
import type { BrowserEventEnricher } from '../enrichment/browser-event.enricher';
import type { EventTimeGuard } from '../enrichment/event-time.guard';
import type { PiiFinding } from '../enrichment/pii-findings';
import type { ServerEventEnricher } from '../enrichment/server-event.enricher';
import { ServiceUnavailableError } from '../errors/app-error';
import type { Logger } from '../lib/logger';
import type { LiveFeed } from '../live/live-feed';
import type { ApiRequestIngestRepository } from '../repositories/api-request-ingest.repository';
import type { IngestCounterRepository } from '../repositories/ingest-counter.repository';
import type { IngestRejectionRepository } from '../repositories/ingest-rejection.repository';
import type { PartitionRepository } from '../repositories/partition.repository';
import type { PiiDetectionRepository } from '../repositories/pii-detection.repository';
import type { SsoCookieOutcomeRepository } from '../repositories/sso-cookie-outcome.repository';
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
  piiFindings: PiiFinding[];
}

/** A rejected event: the response entry plus the value-free schema path stored for the KPI. */
interface RejectedEvent {
  rejection: IngestRejection;
  schemaPath: string;
}

interface PreparedBatch<R extends EventRow = ApiRequestInsert> {
  candidates: Candidate<R>[];
  rejected: RejectedEvent[];
  warnings: IngestWarning[];
}

/** A candidate the DB refused, with the violated constraint's name when pg exposed one. */
interface PoisonRow<R extends EventRow> extends Candidate<R> {
  constraint: string | undefined;
}

interface InsertOutcome<R extends EventRow> {
  insertedIds: string[];
  poison: PoisonRow<R>[];
}

/** Stored outcome of one batch: the IngestResultDto plus what the after-commit steps need. */
interface StoredBatch<R extends EventRow> {
  result: IngestResultDto;
  inserted: Candidate<R>[];
  rejected: RejectedEvent[];
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

/** The normalised path of the first zod issue — the shape only, never the message. */
function schemaPathOfIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? normalizeSchemaPath(issue.path) : NO_SCHEMA_PATH;
}

function reject(index: number, code: IngestEventRejectCode, message: string, schemaPath: string): RejectedEvent {
  return { rejection: { index, code, message }, schemaPath };
}

function rejectFixed(index: number, code: IngestEventRejectCode, message: string): RejectedEvent {
  return reject(index, code, message, FIXED_SCHEMA_PATHS[code] ?? NO_SCHEMA_PATH);
}

/** node-postgres DatabaseError exposes the violated constraint as `constraint`. */
function constraintOf(err: unknown): string | undefined {
  if (err === null || typeof err !== 'object') return undefined;
  const constraint = (err as { constraint?: unknown }).constraint;
  return typeof constraint === 'string' ? constraint : undefined;
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
    private readonly rejections: IngestRejectionRepository,
    private readonly piiDetections: PiiDetectionRepository,
    private readonly ssoOutcomes: SsoCookieOutcomeRepository,
    private readonly partitions: PartitionRepository,
    private readonly serverEnricher: ServerEventEnricher,
    private readonly browserEnricher: BrowserEventEnricher,
    private readonly timeGuard: EventTimeGuard,
    private readonly liveFeed: LiveFeed,
    private readonly logger: Logger,
    /** `new URL(env.PUBLIC_ORIGIN).origin` — the collector's own origin (same-origin beacons). */
    private readonly publicOrigin: string,
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
        rejected: batch.rejected.map((r) => r.rejection),
        warnings: batch.warnings,
        dryRun: true,
      };
    }
    const stored = await this.storeBatch(batch, (rows) => this.apiRequests.insertBatch(rows));
    await this.recordAfterCommit(ctx, 'server', stored);
    this.publishLive(ctx, stored.inserted, (rows) => this.liveFeed.recordApiRequests(ctx.app, rows));
    return stored.result;
  }

  /** POST ROUTES.ingest.browser (publishable key; origin and session limits checked by middleware). */
  async ingestBrowserEvents(envelope: BrowserIngestEnvelope, ctx: BrowserIngestContext): Promise<IngestResultDto> {
    const { batch, ssoOutcome } = this.prepareBrowser(envelope, ctx);
    const stored = await this.storeBatch(batch, (rows) => this.webEvents.insertBatch(rows));
    await this.recordAfterCommit(ctx, 'browser', stored);
    if (ssoOutcome) await this.recordSsoOutcome(ctx, ssoOutcome);
    this.publishLive(ctx, stored.inserted, (rows) => this.liveFeed.recordWebEvents(ctx.app, rows));
    return stored.result;
  }

  verify(ctx: IngestContext): VerifyResponseDto {
    return {
      app: { slug: ctx.app.slug, displayName: ctx.app.display_name },
      keyKind: ctx.key.kind,
      contractVersion: INGEST_CONTRACT_VERSION,
      serverTime: ctx.receivedAt.toISOString(),
    };
  }

  /** POST ROUTES.ingest.config — the remote config of the authenticated app (ADR 0009). */
  config(app: AppRow): SdkRemoteConfig {
    return toSdkRemoteConfig(app);
  }

  // ─── Validation + enrichment ──────────────────────────────────────────────

  private prepare(envelope: ServerIngestEnvelope, ctx: IngestContext): PreparedBatch {
    const skew = this.timeGuard.skewMs(envelope.sentAt, ctx.receivedAt);
    const envelopeInfo = this.serverEnricher.enrichEnvelope(ctx);
    const batch: PreparedBatch = { candidates: [], rejected: [], warnings: [] };
    envelope.events.forEach((raw, index) => {
      const parsed = serverEventSchema.safeParse(raw);
      if (!parsed.success) {
        batch.rejected.push(
          reject(index, ERROR_CODES.INVALID_EVENT, describeIssue(parsed.error), schemaPathOfIssue(parsed.error)),
        );
        return;
      }
      if (!this.timeGuard.isAcceptable(new Date(parsed.data.occurredAt), ctx.receivedAt)) {
        batch.rejected.push(rejectFixed(index, ERROR_CODES.EVENT_TIME_OUT_OF_RANGE, MESSAGES.outOfWindow));
        return;
      }
      const enriched = this.serverEnricher.enrich(parsed.data, ctx, skew, envelopeInfo.environment);
      batch.candidates.push({ index, row: enriched.row, piiFindings: enriched.piiFindings });
      for (const warning of enriched.warnings) batch.warnings.push({ index, ...warning });
    });
    this.warnOnFirstStored(batch, envelopeInfo.warnings);
    return batch;
  }

  private prepareBrowser(
    envelope: BrowserIngestEnvelope,
    ctx: BrowserIngestContext,
  ): { batch: PreparedBatch<WebEventInsert>; ssoOutcome: SsoCookieOutcome | null } {
    const skew = this.timeGuard.skewMs(envelope.sentAt, ctx.receivedAt);
    const actor = this.browserEnricher.enrichActor(envelope, ctx);
    const batch: PreparedBatch<WebEventInsert> = { candidates: [], rejected: [], warnings: [] };
    envelope.events.forEach((raw, index) => {
      const parsed = browserEventSchema.safeParse(raw);
      if (!parsed.success) {
        batch.rejected.push(
          reject(index, ERROR_CODES.INVALID_EVENT, describeIssue(parsed.error), schemaPathOfIssue(parsed.error)),
        );
        return;
      }
      if (!this.timeGuard.isAcceptable(new Date(parsed.data.occurredAt), ctx.receivedAt)) {
        batch.rejected.push(rejectFixed(index, ERROR_CODES.EVENT_TIME_OUT_OF_RANGE, MESSAGES.outOfWindow));
        return;
      }
      if (!isWithinBasePath(parsed.data.path, ctx.app.base_path)) {
        batch.rejected.push(rejectFixed(index, ERROR_CODES.PATH_OUTSIDE_APP, MESSAGES.outsideApp));
        return;
      }
      const enriched = this.browserEnricher.enrich(parsed.data, envelope, ctx, actor, skew);
      batch.candidates.push({ index, row: enriched.row, piiFindings: enriched.piiFindings });
      for (const warning of enriched.warnings) batch.warnings.push({ index, ...warning });
    });
    this.warnOnFirstStored(batch, actor.warnings);
    return { batch, ssoOutcome: actor.ssoOutcome };
  }

  /** Envelope-level warnings (user.email, environment, tz, lang, release) go on the first stored event. */
  private warnOnFirstStored<R extends EventRow>(
    batch: PreparedBatch<R>,
    warnings: readonly { field: string; code: IngestWarning['code'] }[],
  ): void {
    const first = batch.candidates[0];
    if (first) batch.warnings.unshift(...warnings.map((warning) => ({ index: first.index, ...warning })));
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
      ...outcome.poison.map((p) =>
        reject(p.index, ERROR_CODES.DB_CONSTRAINT, MESSAGES.dbConstraint, schemaPathOfConstraint(p.constraint)),
      ),
    ].sort((a, b) => byIndex(a.rejection, b.rejection));
    const result: IngestResultDto = {
      accepted: inserted.length,
      duplicates: inBatchDuplicates + dbDuplicates,
      rejected: rejected.map((r) => r.rejection),
      warnings: batch.warnings,
    };
    return { result, inserted, rejected };
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
      if (candidates.length === 1) {
        return { insertedIds: [], poison: candidates.map((c) => ({ ...c, constraint: constraintOf(err) })) };
      }
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

  private async recordAfterCommit<R extends EventRow>(
    ctx: IngestContext,
    source: IngestSource,
    stored: StoredBatch<R>,
  ): Promise<void> {
    await this.count(ctx, source, stored.result);
    await this.recordRejections(ctx, source, stored.rejected);
    await this.recordPii(ctx, source, stored.inserted);
  }

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

  private async recordRejections(ctx: IngestContext, source: IngestSource, rejected: RejectedEvent[]): Promise<void> {
    if (rejected.length === 0) return;
    try {
      const keys = rejected.map((r) => ({ code: r.rejection.code, schemaPath: r.schemaPath }));
      const rows = toRejectionIncrements(source, normalizeSdkLabel(ctx.sdk), keys);
      await this.rejections.increment(ctx.app.id, rows, ctx.receivedAt);
    } catch (err) {
      this.logger.warn('ingest rejection counter update failed', { err, appId: ctx.app.id });
    }
  }

  private async recordPii(ctx: IngestContext, source: IngestSource, inserted: Candidate<EventRow>[]): Promise<void> {
    const rows = toPiiIncrements(inserted.map((candidate) => candidate.piiFindings));
    if (rows.length === 0) return;
    try {
      await this.piiDetections.increment(ctx.app.id, source, rows, ctx.receivedAt);
    } catch (err) {
      this.logger.warn('pii detection counter update failed', { err, appId: ctx.app.id });
    }
  }

  /** Once per (non-replay) beacon. */
  private async recordSsoOutcome(ctx: BrowserIngestContext, outcome: SsoCookieOutcome): Promise<void> {
    try {
      const beaconOrigin = beaconOriginOf(ctx.request.origin, this.publicOrigin);
      await this.ssoOutcomes.increment(ctx.app.id, outcome, beaconOrigin, ctx.receivedAt);
    } catch (err) {
      this.logger.warn('sso cookie outcome update failed', { err, appId: ctx.app.id });
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
