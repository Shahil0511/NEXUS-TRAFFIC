/**
 * Every 6 h: make sure this month's ±window partitions exist (cross-replica safe via advisory lock).
 *
 * The work runs on the SAME transaction client that holds the lock (passed down as `exec`), so two
 * replicas can never run it at the same time.
 */
import type { Pool } from 'pg';

import { withAdvisoryXactLock } from '../db/transaction';
import { ADVISORY_LOCKS } from '../db/schema';
import type { PartitionService } from '../services/partition.service';

export const PARTITION_MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;

export class PartitionMaintenanceJob {
  constructor(
    private readonly db: Pool,
    private readonly partitions: PartitionService,
  ) {}

  async run(): Promise<void> {
    await withAdvisoryXactLock(this.db, ADVISORY_LOCKS.partitions, (client) => this.partitions.ensureAhead(client));
  }
}
