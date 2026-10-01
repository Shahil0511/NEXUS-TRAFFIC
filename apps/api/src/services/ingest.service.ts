/**
 * Ingest use cases (synchronous: a 202 means the rows are committed).
 *
 * ingestServerEvents:
 *   per event: serverEventSchema.safeParse → EventTimeGuard → ServerEventEnricher (→ warnings)
 *   → ApiRequestIngestRepository.insertBatch (unless dryRun)
 *       · isMissingPartition → PartitionRepository.ensure(1, 2) and retry ONCE
 *       · isDataError → bisect the batch, reject only the poison rows (DB_CONSTRAINT, with index)
 *       · isUnavailable → 503 INGEST_UNAVAILABLE
 *   → IngestCounterRepository.increment → LiveFeed.recordApiRequests(inserted rows only)
 *   → IngestResultDto { accepted, duplicates, rejected[], warnings[] }
 * @see ../repositories/api-request-ingest.repository.ts ApiRequestIngestRepository.insertBatch
 */
import type { IngestResultDto, ServerIngestEnvelope, VerifyResponseDto } from '@nexus/shared';

import type { IngestContext } from '../domain/viewer';
import type { EventTimeGuard } from '../enrichment/event-time.guard';
import type { ServerEventEnricher } from '../enrichment/server-event.enricher';
import type { LiveFeed } from '../live/live-feed';
import type { Logger } from '../lib/logger';
import { notImplemented } from '../lib/not-implemented';
import type { ApiRequestIngestRepository } from '../repositories/api-request-ingest.repository';
import type { IngestCounterRepository } from '../repositories/ingest-counter.repository';
import type { PartitionRepository } from '../repositories/partition.repository';

export interface IngestOptions {
  dryRun: boolean;
}

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
    void envelope;
    void ctx;
    void options;
    void this.apiRequests;
    void this.counters;
    void this.partitions;
    void this.serverEnricher;
    void this.timeGuard;
    void this.liveFeed;
    void this.logger;
    throw notImplemented('IngestService.ingestServerEvents');
  }

  verify(ctx: IngestContext): VerifyResponseDto {
    void ctx;
    throw notImplemented('IngestService.verify');
  }
}
