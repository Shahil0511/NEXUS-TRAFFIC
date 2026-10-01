/**
 * Nightly at 02:30 Asia/Kolkata: drop monthly partitions older than RAW_RETENTION_MONTHS.
 * The scheduler checks every 15 minutes and runs once per IST day inside the 02:30–03:30 window.
 *
 * Cross-replica safe: the drop runs on the transaction client holding ADVISORY_LOCKS.retention.
 * If another replica holds the lock, it is doing today's run, so this one counts the day as done.
 * If the drop FAILS (e.g. 55P03 lock_timeout), the day is NOT marked done and the next tick
 * (15 minutes later, still inside the window) retries.
 */
import type { Pool } from 'pg';

import { withAdvisoryXactLock } from '../db/transaction';
import { ADVISORY_LOCKS } from '../db/schema';
import type { Clock } from '../lib/clock';
import type { Logger } from '../lib/logger';
import type { PartitionService } from '../services/partition.service';

export const RETENTION_CHECK_INTERVAL_MS = 15 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
/** 02:30–03:30 IST, in minutes since IST midnight. */
const WINDOW_START_MINUTES = 150;
const WINDOW_END_MINUTES = 210;

/** IST calendar date + minutes since IST midnight (India has no DST). */
function istParts(now: Date): { day: string; minutes: number } {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return { day: ist.toISOString().slice(0, 10), minutes: ist.getUTCHours() * 60 + ist.getUTCMinutes() };
}

export class RetentionJob {
  private lastRunDay: string | null = null;

  constructor(
    private readonly db: Pool,
    private readonly partitions: PartitionService,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  /** Called every RETENTION_CHECK_INTERVAL_MS; does work at most once per IST day. */
  async run(): Promise<void> {
    const { day, minutes } = istParts(this.clock.now());
    const inWindow = minutes >= WINDOW_START_MINUTES && minutes < WINDOW_END_MINUTES;
    if (!inWindow || this.lastRunDay === day) return;
    const outcome = await withAdvisoryXactLock(this.db, ADVISORY_LOCKS.retention, (client) =>
      this.partitions.dropExpired(client),
    );
    this.lastRunDay = day;
    if (!outcome.ran) {
      this.logger.info('retention run skipped: another replica holds the lock');
      return;
    }
    this.logger.info('retention run', { droppedCount: outcome.result.length });
  }
}
