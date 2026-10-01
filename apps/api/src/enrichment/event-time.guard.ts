/**
 * Event-time acceptance (EVENT_CLOCK_POLICY): an event must have occurred within
 * [receivedAt − 7 days, receivedAt + 5 minutes]. Out-of-window events are REJECTED, never clamped —
 * occurred_at is part of the idempotency key and must be identical on every retry.
 */
import { EVENT_CLOCK_POLICY } from '@nexus/shared';

/** WHY: keeps events inside the partitions that exist and stops wildly wrong clocks polluting charts. */
export class EventTimeGuard {
  isAcceptable(occurredAt: Date, receivedAt: Date): boolean {
    const occurred = occurredAt.getTime();
    const received = receivedAt.getTime();
    if (Number.isNaN(occurred) || Number.isNaN(received)) return false;
    return (
      occurred >= received - EVENT_CLOCK_POLICY.maxBackdateMs &&
      occurred <= received + EVENT_CLOCK_POLICY.maxFutureMs
    );
  }

  /** receivedAt − sentAt in ms (metadata only; null when sentAt is invalid). */
  skewMs(sentAt: string, receivedAt: Date): number | null {
    const sent = Date.parse(sentAt);
    const received = receivedAt.getTime();
    return Number.isFinite(sent) && Number.isFinite(received) ? received - sent : null;
  }
}
