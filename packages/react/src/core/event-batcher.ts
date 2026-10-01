/**
 * WHY: batches events into contract-sized requests.
 * - flush at `SDK_DEFAULTS.browser.flushEvents` events (the tracker also flushes on a timer,
 *   on `hidden` and on `pagehide`);
 * - bounded queue (`maxQueue`, drop OLDEST) so a dead collector never grows memory;
 * - every request ≤ `INGEST_LIMITS.browser.maxEvents` events AND ≤ `maxBodyBytes`;
 * - one request carries ONE session (the envelope has a single `sessionId`), so a context change
 *   (session rotation, sign-in) flushes what was queued under the previous one first.
 */
import { INGEST_LIMITS, SDK_DEFAULTS } from '@nexus/shared/constants';

import type { BrowserWireEvent } from './wire';

export interface EnvelopeContext {
  sessionId: string;
  email?: string;
}

export interface BatcherLimits {
  flushEvents: number;
  maxQueue: number;
  maxEvents: number;
  maxBodyBytes: number;
}

export const DEFAULT_BATCHER_LIMITS: BatcherLimits = {
  flushEvents: SDK_DEFAULTS.browser.flushEvents,
  maxQueue: SDK_DEFAULTS.browser.maxQueue,
  maxEvents: INGEST_LIMITS.browser.maxEvents,
  maxBodyBytes: INGEST_LIMITS.browser.maxBodyBytes,
};

/** Serialises a chunk under a context into the request body (the tracker owns the envelope). */
export type EnvelopeSerializer = (context: EnvelopeContext, events: BrowserWireEvent[]) => string;

export class EventBatcher {
  private queue: BrowserWireEvent[] = [];
  private context: EnvelopeContext | undefined;
  private dropped = 0;

  constructor(
    private readonly serialize: EnvelopeSerializer,
    private readonly send: (json: string) => void,
    private readonly limits: BatcherLimits = DEFAULT_BATCHER_LIMITS,
  ) {}

  /** WHY: the only way in — handles context switches, overflow and the size trigger. */
  enqueue(event: BrowserWireEvent, context: EnvelopeContext): void {
    if (this.context && !sameContext(this.context, context)) this.flush();
    this.context = context;
    this.queue.push(event);
    if (this.queue.length > this.limits.maxQueue) {
      this.queue.shift();
      this.dropped++;
    }
    if (this.queue.length >= this.limits.flushEvents) this.flush();
  }

  /** WHY: sends everything queued, split into contract-sized requests. NEVER throws. */
  flush(): void {
    const context = this.context;
    const events = this.queue;
    this.queue = [];
    if (!context || events.length === 0) return;
    try {
      for (const chunk of this.chunk(context, events)) this.send(this.serialize(context, chunk));
    } catch {
      // Lost batch: never surface tracker errors to the host app.
    }
  }

  /** Events dropped because the queue overflowed (diagnostics). */
  droppedCount(): number {
    return this.dropped;
  }

  /** WHY: greedy split by event count and exact UTF-8 body size; an oversized lone event is dropped. */
  private chunk(context: EnvelopeContext, events: BrowserWireEvent[]): BrowserWireEvent[][] {
    const overhead = byteLength(this.serialize(context, []));
    const chunks: BrowserWireEvent[][] = [];
    let current: BrowserWireEvent[] = [];
    let size = overhead;
    for (const event of events) {
      const eventBytes = byteLength(JSON.stringify(event)) + 1; // + the separating comma
      if (overhead + eventBytes > this.limits.maxBodyBytes) {
        this.dropped++;
        continue;
      }
      const full =
        current.length >= this.limits.maxEvents || size + eventBytes > this.limits.maxBodyBytes;
      if (full && current.length > 0) {
        chunks.push(current);
        current = [];
        size = overhead;
      }
      current.push(event);
      size += eventBytes;
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
  }
}

function sameContext(a: EnvelopeContext, b: EnvelopeContext): boolean {
  return a.sessionId === b.sessionId && a.email === b.email;
}

/** WHY: the body limit is in BYTES; non-ASCII labels take more than one byte each. */
export function byteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
  return value.length * 3; // safe over-estimate
}
