import type { NexusServerEvent } from '../types';

/**
 * WHY: a bounded FIFO so a dead collector can never grow the host app's memory. When full, the
 * OLDEST event goes (recent traffic is worth more) and the loss is counted, never silent.
 */
export class EventQueue {
  private readonly items: NexusServerEvent[] = [];
  private droppedCount = 0;

  constructor(private readonly maxSize: number) {}

  get size(): number {
    return this.items.length;
  }

  get dropped(): number {
    return this.droppedCount;
  }

  /** Append a new event at the back. */
  push(event: NexusServerEvent): void {
    this.items.push(event);
    this.trim();
  }

  /** Put events back at the FRONT (kept during an auth pause), preserving their order. */
  requeue(events: readonly NexusServerEvent[]): void {
    this.items.unshift(...events);
    this.trim();
  }

  /** Remove and return up to `count` events from the front. */
  take(count: number): NexusServerEvent[] {
    return this.items.splice(0, Math.max(0, count));
  }

  /** Count events lost outside the queue (refused batches, exhausted retries…). */
  countDropped(count: number): void {
    this.droppedCount += count;
  }

  private trim(): void {
    const overflow = this.items.length - this.maxSize;
    if (overflow <= 0) return;
    this.items.splice(0, overflow);
    this.droppedCount += overflow;
  }
}
