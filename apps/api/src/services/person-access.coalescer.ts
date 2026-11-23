/**
 * In-memory "seen recently" set behind the person access log's coalescing.
 *
 * WHY in memory and not in SQL: a person page fires several requests per open (four tabs,
 * refetches, "Load more"). Deciding here costs no database round trip for the repeats, and the
 * error is always on the safe side: after a restart, or on a second api replica, the same open is
 * recorded once more — a duplicate row, never a missing one. Concurrent requests with the same
 * key are handled by PersonAccessRecorder (they wait for the running attempt and retry when it
 * wrote nothing), so a race cannot lose a row either.
 */
export class PersonAccessCoalescer {
  /** key → expiry (epoch ms). */
  private readonly until = new Map<string, number>();

  constructor(private readonly windowMs: number) {}

  /**
   * True when `key` was not claimed inside the window ending at `nowMs` — and claims it until
   * nowMs + windowMs. False for a repeat (the caller records nothing).
   */
  claim(key: string, nowMs: number): boolean {
    const expiry = this.until.get(key);
    if (expiry !== undefined && expiry > nowMs) return false;
    this.until.set(key, nowMs + this.windowMs);
    this.prune(nowMs);
    return true;
  }

  /** Forgets a claim whose recording did not happen, so the next request tries again. */
  release(key: string): void {
    this.until.delete(key);
  }

  /** Number of live claims (tests). */
  get size(): number {
    return this.until.size;
  }

  /** Drops expired claims, so the map holds at most the opens of the last window. */
  private prune(nowMs: number): void {
    for (const [key, expiry] of this.until) {
      if (expiry <= nowMs) this.until.delete(key);
    }
  }
}
