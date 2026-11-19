/**
 * Retention of the hourly diagnostic aggregates (ADR 0013): everything older than
 * AGGREGATE_RETENTION_DAYS is deleted. Called by RetentionJob inside its advisory-lock transaction,
 * right after the raw partitions are dropped — the job never calls a repository directly.
 * @see ../repositories/aggregate-retention.repository.ts AggregateRetentionRepository.deleteExpired
 */
import { AGGREGATE_RETENTION_DAYS, GRAIN_MS } from '@nexus/shared';

import type { Executor } from '../db/executor';
import type { Clock } from '../lib/clock';
import type { Logger } from '../lib/logger';
import type { AggregateRetentionRepository } from '../repositories/aggregate-retention.repository';

/** WHY: one owner for the aggregate cutoff, so the job and tests agree on "expired". */
export class AggregateRetentionService {
  constructor(
    private readonly aggregates: AggregateRetentionRepository,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  /** The oldest bucket_hour that is kept. */
  cutoff(): Date {
    return new Date(this.clock.now().getTime() - AGGREGATE_RETENTION_DAYS * GRAIN_MS.day);
  }

  /** @see AggregateRetentionRepository.deleteExpired */
  async deleteExpired(exec?: Executor): Promise<number> {
    const deleted = await this.aggregates.deleteExpired(this.cutoff(), exec);
    if (deleted > 0) this.logger.info('expired aggregate rows deleted', { deleted });
    return deleted;
  }
}
