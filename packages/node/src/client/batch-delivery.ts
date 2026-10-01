import { SDK_DEFAULTS } from '@nexus/shared/constants';

import type { NexusServerEvent } from '../types';
import { halve } from './batch-splitter';
import { backoffDelayMs, retryAfterMs, sleep } from './delays';
import type { Diagnostics } from './diagnostics';
import type { EventQueue } from './event-queue';
import { classifyResponse, type IngestOutcome } from './response-classifier';
import type { IngestTransport } from './transport';

/** Counters the delivery loop updates; read by NexusClient.stats(). */
export interface DeliveryCounters {
  accepted: number;
  duplicates: number;
  rejected: number;
  attempts: number;
}

/** Pauses ALL sending (auth failure, intercepting proxy) without losing the queue. */
export interface SendPause {
  pauseFor(ms: number): void;
}

/** What the attempt loop decided for a batch. */
type AttemptResult = { settled: true; keep: NexusServerEvent[] } | { settled: false; waitMs: number };

/**
 * Sends ONE batch following the retry table of guide chapter 4:
 * 202 done · 400/415 drop · 401/403 pause + keep · 413 halve · 429/503 Retry-After ·
 * 5xx/network/timeout backoff 1/2/4 s ±20 % · 3xx/non-JSON = proxy (pause + loud log) ·
 * max 3 attempts, then drop.
 *
 * WHY a class: the loop (attempts, sleeping) is separate from the per-outcome decisions
 * (`settle`), and both are separate from HTTP (IngestTransport) and classification.
 */
export class BatchDelivery {
  constructor(
    private readonly transport: IngestTransport,
    private readonly queue: EventQueue,
    private readonly counters: DeliveryCounters,
    private readonly pause: SendPause,
    private readonly diagnostics: Diagnostics,
    private readonly endpoint: string,
  ) {}

  /** Deliver a batch. Resolves with the events to KEEP queued (auth pause); NEVER rejects. */
  async deliver(events: readonly NexusServerEvent[]): Promise<NexusServerEvent[]> {
    const { maxAttempts } = SDK_DEFAULTS.retry;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const result = await this.attempt(events, attempt);
      if (result.settled) return result.keep;
      if (attempt < maxAttempts) await sleep(result.waitMs);
    }
    return this.drop(events, 'gave-up', `gave up after ${maxAttempts} attempts`);
  }

  /** One HTTP attempt → an outcome → a decision. */
  private async attempt(events: readonly NexusServerEvent[], attempt: number): Promise<AttemptResult> {
    this.counters.attempts += 1;
    let outcome: IngestOutcome;
    try {
      outcome = classifyResponse(await this.transport.send(events));
    } catch (error) {
      outcome = { action: 'backoff', reason: describeNetworkError(error) };
    }
    if (outcome.action === 'retryAfter') {
      return { settled: false, waitMs: retryAfterMs(outcome.header) };
    }
    if (outcome.action === 'backoff') {
      this.diagnostics.warn('transient', `send failed (${outcome.reason}); retrying`);
      return { settled: false, waitMs: backoffDelayMs(attempt) };
    }
    return { settled: true, keep: await this.settle(events, outcome) };
  }

  /** Apply a final outcome. Returns the events to keep queued. */
  private async settle(
    events: readonly NexusServerEvent[],
    outcome: Exclude<IngestOutcome, { action: 'retryAfter' | 'backoff' }>,
  ): Promise<NexusServerEvent[]> {
    switch (outcome.action) {
      case 'done':
        this.counters.accepted += outcome.accepted;
        this.counters.duplicates += outcome.duplicates;
        this.counters.rejected += outcome.rejected;
        if (outcome.rejected > 0) {
          this.diagnostics.warn('rejected', `${outcome.rejected} event(s) rejected by the server — fix the sender`);
        }
        return [];
      case 'drop':
        return this.drop(events, 'refused', `batch refused (${outcome.reason}) — fix the sender`);
      case 'pauseAuth':
        this.pause.pauseFor(SDK_DEFAULTS.retry.authPauseMs);
        this.diagnostics.warn(
          'auth',
          `HTTP ${outcome.status}: key refused — pausing 5 minutes, events kept (check NEXUS_SECRET_KEY)`,
        );
        return [...events];
      case 'split':
        return this.split(events);
      case 'proxy':
        this.pause.pauseFor(SDK_DEFAULTS.retry.authPauseMs);
        this.diagnostics.loudOnce(
          'proxy',
          `ingest URL is intercepted by a proxy (HTTP ${outcome.status}, not a JSON answer from Nexus): ${this.endpoint} — check NEXUS_URL; see docs chapter 11`,
        );
        return this.drop(events, 'proxy', 'batch dropped (intercepted)');
    }
  }

  /** 413: halve and send both halves; a single event that is still too large is dropped. */
  private async split(events: readonly NexusServerEvent[]): Promise<NexusServerEvent[]> {
    if (events.length <= 1) return this.drop(events, 'oversize', 'event over the body limit dropped');
    const [first, second] = halve(events);
    const keepFirst = await this.deliver(first);
    const keepSecond = await this.deliver(second);
    return [...keepFirst, ...keepSecond];
  }

  private drop(events: readonly NexusServerEvent[], topic: string, message: string): NexusServerEvent[] {
    this.queue.countDropped(events.length);
    this.diagnostics.warn(topic, `${message}; ${events.length} event(s) dropped`);
    return [];
  }
}

/** A short, secret-free description of a fetch failure. */
function describeNetworkError(error: unknown): string {
  if (error instanceof Error) return error.name === 'AbortError' ? 'timeout' : error.name;
  return 'network error';
}
