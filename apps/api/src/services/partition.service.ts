/**
 * Partition maintenance use cases, called by jobs and at boot.
 * @see ../repositories/partition.repository.ts
 */
import { PARTITIONED_TABLES } from '../db/schema';
import type { Logger } from '../lib/logger';
import type { PartitionRepository } from '../repositories/partition.repository';

/** Look back 1 month (events may be up to 7 days old) and 2 months ahead. */
export const PARTITION_MONTHS_BACK = 1;
export const PARTITION_MONTHS_AHEAD = 2;

export class PartitionService {
  constructor(
    private readonly partitions: PartitionRepository,
    private readonly retentionMonths: number,
    private readonly logger: Logger,
  ) {}

  async ensureAhead(): Promise<void> {
    const names = await this.partitions.ensure(PARTITION_MONTHS_BACK, PARTITION_MONTHS_AHEAD);
    this.logger.debug('partitions ensured', { count: names.length });
  }

  async dropExpired(): Promise<string[]> {
    const dropped: string[] = [];
    for (const table of PARTITIONED_TABLES) {
      dropped.push(...(await this.partitions.dropExpired(table, this.retentionMonths)));
    }
    if (dropped.length > 0) this.logger.info('expired partitions dropped', { dropped });
    return dropped;
  }
}
