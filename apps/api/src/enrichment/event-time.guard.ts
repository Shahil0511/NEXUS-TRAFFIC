/**
 * Event-time acceptance (EVENT_CLOCK_POLICY): an event must have occurred within
 * [receivedAt − 7 days, receivedAt + 5 minutes]. Out-of-window events are REJECTED, never clamped —
 * occurred_at is part of the idempotency key and must be identical on every retry.
 */
import { notImplemented } from '../lib/not-implemented';

export class EventTimeGuard {
  isAcceptable(occurredAt: Date, receivedAt: Date): boolean {
    void occurredAt;
    void receivedAt;
    throw notImplemented('EventTimeGuard.isAcceptable');
  }

  /** receivedAt − sentAt in ms (metadata only; null when sentAt is invalid). */
  skewMs(sentAt: string, receivedAt: Date): number | null {
    void sentAt;
    void receivedAt;
    throw notImplemented('EventTimeGuard.skewMs');
  }
}
