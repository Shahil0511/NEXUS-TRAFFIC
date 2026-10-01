/**
 * WHY: time on page is the SUM of `page_time.visibleMs` deltas per page view, so the tracker only
 * ever needs "visible milliseconds since the last time I asked". Time while the tab is hidden is
 * NEVER counted (Page Visibility API).
 */
import { INGEST_LIMITS } from '@nexus/shared/constants';

export class VisibleTimer {
  private accumulated = 0;
  private visibleSince: number | null = null;

  /** WHY: a new page view starts counting from zero. */
  reset(now: number, visible: boolean): void {
    this.accumulated = 0;
    this.visibleSince = visible ? now : null;
  }

  /** WHY: banks the running visible stretch when the tab is hidden. */
  pause(now: number): void {
    if (this.visibleSince === null) return;
    this.accumulated += Math.max(0, now - this.visibleSince);
    this.visibleSince = null;
  }

  /** WHY: restarts counting when the tab becomes visible again. */
  resume(now: number): void {
    if (this.visibleSince === null) this.visibleSince = now;
  }

  /** WHY: hands out the delta since the last take and starts a new one. Integer, contract-clamped. */
  take(now: number): number {
    let total = this.accumulated;
    if (this.visibleSince !== null) {
      total += Math.max(0, now - this.visibleSince);
      this.visibleSince = now;
    }
    this.accumulated = 0;
    return Math.min(Math.round(total), INGEST_LIMITS.maxVisibleMs);
  }
}
