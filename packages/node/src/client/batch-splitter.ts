import type { NexusServerEvent } from '../types';

/** WHY: room for `{"sentAt":"…","sdk":{…},"events":[]}` around the events — generous on purpose. */
const ENVELOPE_OVERHEAD_BYTES = 512;

const encoder = new TextEncoder();

/** UTF-8 size of one serialized event; Infinity when it cannot be serialized (dropped as oversize). */
export function eventByteSize(event: NexusServerEvent): number {
  try {
    return encoder.encode(JSON.stringify(event)).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export interface SplitResult {
  batches: NexusServerEvent[][];
  /** Events that cannot fit in ANY request on their own — they are dropped. */
  oversize: NexusServerEvent[];
}

/**
 * WHY: the server refuses a body over INGEST_LIMITS.server.maxBodyBytes (413) or more than
 * maxEvents events (400), so batches are cut to fit BEFORE sending instead of failing first.
 * Greedy and order-preserving.
 */
export function splitIntoBatches(
  events: readonly NexusServerEvent[],
  maxEvents: number,
  maxBodyBytes: number,
): SplitResult {
  const budget = maxBodyBytes - ENVELOPE_OVERHEAD_BYTES;
  const batches: NexusServerEvent[][] = [];
  const oversize: NexusServerEvent[] = [];
  let current: NexusServerEvent[] = [];
  let currentBytes = 0;
  for (const event of events) {
    const size = eventByteSize(event) + 1; // + the separating comma
    if (size > budget) {
      oversize.push(event);
      continue;
    }
    if (current.length >= maxEvents || currentBytes + size > budget) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(event);
    currentBytes += size;
  }
  if (current.length > 0) batches.push(current);
  return { batches, oversize };
}

/** Halve a batch the server answered 413 to. */
export function halve<T>(items: readonly T[]): [T[], T[]] {
  const middle = Math.ceil(items.length / 2);
  return [items.slice(0, middle), items.slice(middle)];
}
