/**
 * In-page delivery of serialised batches (ADR 0012).
 *
 * WHY
 * - ONE batch in flight at a time: keepalive requests share a 64 KiB budget per page.
 * - Outcomes come from `classifyDelivery` (transport.ts):
 *   delivered → done; drop → done; disabled → the kill switch;
 *   retry (429/5xx) → back off per SDK_DEFAULTS.retry, persist after `maxAttempts`;
 *   retry_opaque (network/opaque) → back off, persisted at most ONCE.
 * - On `hidden` / `pagehide` (`unload()`), batches that already failed — the one in flight
 *   included — are persisted for the next load; batches never tried go out by beacon.
 * - BOUNDED: at most `SDK_DEFAULTS.browser.maxPendingBatches` batches wait in memory. Beyond that
 *   the oldest waiting one is handed to the retry queue (or counted as dropped), so a slow or dead
 *   collector never grows memory nor a burst of unload beacons.
 * NEVER throws.
 */
import { SDK_DEFAULTS } from '@nexus/shared/constants';

import type { DeliveryOutcome, SendMode, Transport } from './transport';

export interface BatchSenderDeps {
  url: string;
  transport: Transport;
  /** Persist a failed batch for the next load; false when not kept (module off, quota). */
  persist(json: string, attempts: number): boolean;
  /** A persisted batch was delivered in-page after all. */
  forget(json: string): void;
  /** A kill code was received. */
  onDisabled(): void;
  /** A waiting batch was dropped because the in-page queue was full (and could not be persisted). */
  onOverflow?(): void;
  /** Override of `SDK_DEFAULTS.browser.maxPendingBatches` (tests). */
  maxPending?: number;
}

interface PendingBatch {
  json: string;
  attempts: number;
  persistTried: boolean;
  persisted: boolean;
  /** Set for a one-shot send (replays): no retry, no persistence — the caller decides. */
  settle?: (outcome: DeliveryOutcome) => void;
}

export class BatchSender {
  private queue: PendingBatch[] = [];
  private inFlight: PendingBatch | null = null;
  private backoff: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(private readonly deps: BatchSenderDeps) {}

  /** WHY: `live` joins the in-page queue; `unload` goes out right away (beacon). */
  send(json: string, mode: SendMode): void {
    if (this.stopped) return;
    if (mode === 'unload') {
      this.sendUnload({ json, attempts: 0, persistTried: false, persisted: false });
      return;
    }
    this.queue.push({ json, attempts: 0, persistTried: false, persisted: false });
    this.enforceLimit();
    this.pump();
  }

  /** WHY: a replay — sent through the same single-flight queue; resolves with the raw outcome. */
  sendOnce(json: string): Promise<DeliveryOutcome> {
    if (this.stopped) return Promise.resolve('disabled');
    return new Promise((resolve) => {
      this.queue.push({ json, attempts: 0, persistTried: true, persisted: false, settle: resolve });
      this.pump();
    });
  }

  /**
   * WHY: the page may be going away — keep what already failed, beacon what was never tried. The
   * batch IN FLIGHT is persisted too when it already failed once (its retry may never settle once
   * the document is gone); a later in-page delivery forgets it again, and the server de-duplicates
   * by eventId anyway.
   */
  unload(): void {
    const current = this.inFlight;
    if (current && !current.settle && current.attempts > 0) this.persistOnce(current);
    const waiting = this.queue.filter((item) => item !== this.inFlight && !item.settle);
    for (const item of waiting) {
      if (item.attempts > 0) {
        this.persistOnce(item);
        continue;
      }
      this.queue.splice(this.queue.indexOf(item), 1);
      this.sendUnload(item);
    }
  }

  /** WHY: the kill switch was lifted (a valid 200 config) — accept batches again. */
  resume(): void {
    this.stopped = false;
  }

  /** WHY: kill switch — drop everything, never send again (until `resume`). */
  stop(): void {
    this.stopped = true;
    if (this.backoff !== undefined) clearTimeout(this.backoff);
    this.backoff = undefined;
    for (const item of this.queue) item.settle?.('disabled');
    this.queue = [];
  }

  /** Batches waiting in memory (diagnostics). */
  size(): number {
    return this.queue.length;
  }

  /** WHY: drop-oldest bound on the waiting batches (the in-flight one and replays are kept). */
  private enforceLimit(): void {
    const max = this.deps.maxPending ?? SDK_DEFAULTS.browser.maxPendingBatches;
    while (this.queue.length > max) {
      const oldest = this.queue.find((item) => item !== this.inFlight && !item.settle);
      if (!oldest) return;
      this.remove(oldest);
      this.persistOnce(oldest);
      if (!oldest.persisted) this.deps.onOverflow?.();
    }
  }

  private pump(): void {
    if (this.stopped || this.inFlight || this.backoff !== undefined) return;
    const item = this.queue[0];
    if (!item) return;
    this.inFlight = item;
    this.deps.transport(this.deps.url, item.json, 'live').then(
      (outcome) => this.settle(item, outcome),
      () => this.settle(item, 'retry_opaque'),
    );
  }

  private settle(item: PendingBatch, outcome: DeliveryOutcome): void {
    try {
      this.inFlight = null;
      if (this.stopped) return;
      if (item.settle) {
        this.remove(item);
        item.settle(outcome);
        if (outcome === 'disabled') this.deps.onDisabled();
      } else {
        this.handle(item, outcome);
      }
    } catch {
      // never throw
    }
    this.pump();
  }

  private handle(item: PendingBatch, outcome: DeliveryOutcome): void {
    if (outcome === 'disabled') {
      this.deps.onDisabled();
      return;
    }
    if (outcome === 'delivered' || outcome === 'drop') {
      this.remove(item);
      if (item.persisted) this.deps.forget(item.json);
      return;
    }
    item.attempts++;
    if (outcome === 'retry_opaque') this.persistOnce(item);
    if (item.attempts >= SDK_DEFAULTS.retry.maxAttempts) {
      this.remove(item);
      this.persistOnce(item);
      return;
    }
    this.scheduleRetry(item.attempts);
  }

  private sendUnload(item: PendingBatch): void {
    this.deps.transport(this.deps.url, item.json, 'unload').then(
      (outcome) => {
        if (outcome === 'disabled') this.deps.onDisabled();
        else if (outcome === 'retry' || outcome === 'retry_opaque') this.persistOnce(item);
      },
      () => this.persistOnce(item),
    );
  }

  /** WHY: at most ONE persist per batch, whatever happens afterwards. */
  private persistOnce(item: PendingBatch): void {
    if (item.persistTried) return;
    item.persistTried = true;
    item.persisted = this.deps.persist(item.json, Math.max(1, item.attempts));
  }

  /** WHY: exponential back-off with jitter (SDK_DEFAULTS.retry), so tabs do not retry in step. */
  private scheduleRetry(attempts: number): void {
    const { baseDelayMs, jitterRatio } = SDK_DEFAULTS.retry;
    const base = baseDelayMs * 2 ** (attempts - 1);
    const delay = Math.max(0, Math.round(base * (1 + (Math.random() * 2 - 1) * jitterRatio)));
    this.backoff = setTimeout(() => {
      this.backoff = undefined;
      this.pump();
    }, delay);
  }

  private remove(item: PendingBatch): void {
    const index = this.queue.indexOf(item);
    if (index >= 0) this.queue.splice(index, 1);
  }
}
