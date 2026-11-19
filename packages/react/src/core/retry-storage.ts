/**
 * localStorage access for the retry queue (ADR 0012).
 *
 * WHY NOT `SafeStorage`: SafeStorage silently switches to memory after one failure. For the retry
 * queue that would be wrong twice over — a "persisted" batch in memory dies with the page anyway,
 * and after the switch `remove()` (the kill-switch purge) would never reach the real storage. So
 * every call here tries the REAL localStorage; a failed write returns false (the caller drops the
 * batch and counts `persistFailed`). NEVER throws.
 */
export class RetryStorage {
  constructor(
    private readonly resolve: () => Storage | undefined = () =>
      typeof window === 'undefined' ? undefined : window.localStorage,
  ) {}

  get(key: string): string | null {
    try {
      return this.resolve()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  /** WHY: false on QuotaExceededError, blocked storage or no storage at all. */
  set(key: string, value: string): boolean {
    try {
      const storage = this.resolve();
      if (!storage) return false;
      storage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  remove(key: string): void {
    try {
      this.resolve()?.removeItem(key);
    } catch {
      // nothing to remove from
    }
  }
}
