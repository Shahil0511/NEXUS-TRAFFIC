import { randomUUID } from 'node:crypto';

/**
 * WHY: the idempotency key of an event. Create it ONCE when the request is recorded and never
 * regenerate it on retry — the server deduplicates on (eventId, occurredAt).
 */
export function createEventId(): string {
  return randomUUID();
}
