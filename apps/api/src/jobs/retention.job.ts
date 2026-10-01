/**
 * Nightly at 02:30 Asia/Kolkata: drop monthly partitions older than RAW_RETENTION_MONTHS.
 * The scheduler checks every 15 minutes and runs once per IST day inside the 02:30–03:30 window.
 */
import type { Clock } from '../lib/clock';
import type { Logger } from '../lib/logger';
import type { PartitionService } from '../services/partition.service';

export const RETENTION_CHECK_INTERVAL_MS = 15 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** IST calendar date + minutes since IST midnight (India has no DST). */
function istParts(now: Date): { day: string; minutes: number } {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return { day: ist.toISOString().slice(0, 10), minutes: ist.getUTCHours() * 60 + ist.getUTCMinutes() };
}

export class RetentionJob {
  private lastRunDay: string | null = null;

  constructor(
    private readonly partitions: PartitionService,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  /** Called every RETENTION_CHECK_INTERVAL_MS; does work at most once per IST day. */
  async run(): Promise<void> {
    const { day, minutes } = istParts(this.clock.now());
    const inWindow = minutes >= 150 && minutes < 210;
    if (!inWindow || this.lastRunDay === day) return;
    this.lastRunDay = day;
    const dropped = await this.partitions.dropExpired();
    this.logger.info('retention run', { droppedCount: dropped.length });
  }
}
