import type { NexusLogger } from '../types';

/** WHY: one repeated failure must not flood the host app's logs — at most one line per minute. */
const THROTTLE_MS = 60_000;

/**
 * The SDK's only voice. Messages are prefixed `[nexus]`, throttled per topic, and a logger that
 * throws is ignored. NEVER pass keys or full emails here.
 */
export class Diagnostics {
  private readonly lastLoggedAt = new Map<string, number>();
  private readonly loudTopics = new Set<string>();

  constructor(private readonly logger: NexusLogger) {}

  /** A throttled warning (one per topic per minute). */
  warn(topic: string, message: string): void {
    const now = Date.now();
    const last = this.lastLoggedAt.get(topic);
    if (last !== undefined && now - last < THROTTLE_MS) return;
    this.lastLoggedAt.set(topic, now);
    this.write(() => this.logger.warn(`[nexus] ${message}`));
  }

  /** A loud error logged ONCE per topic for the life of the process (needs a human). */
  loudOnce(topic: string, message: string): void {
    if (this.loudTopics.has(topic)) return;
    this.loudTopics.add(topic);
    this.write(() => (this.logger.error ?? this.logger.warn).call(this.logger, `[nexus] ${message}`));
  }

  private write(log: () => void): void {
    try {
      log();
    } catch {
      // a broken logger must never break the host app
    }
  }
}
