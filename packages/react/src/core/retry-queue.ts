/**
 * The persisted retry queue — failed batches survive to the next page load (ADR 0012).
 *
 * BOUNDS (SDK_DEFAULTS.browser), per key scope:
 * - `retryQueueMaxBatches` batches and `retryQueueMaxBytes` bytes (oldest dropped first — host
 *   apps share the origin's storage quota);
 * - `retryQueueTtlMs`, measured on the batch's OLDEST occurredAt (the server would reject it later);
 * - `retryQueueMaxReplays`: a batch replayed on that many loads without delivery is dropped, so a
 *   poison batch cannot loop forever.
 *
 * PRIVACY: the envelope is stored WITHOUT `user`; a replay carries `client.replay: true` so the
 * server skips SSO-cookie identity (the cookie may belong to someone else by then).
 * The event ids, occurredAt, sessionId and seq are kept VERBATIM, so a duplicate delivery is
 * de-duplicated by the server. NEVER throws.
 */
import { SDK_DEFAULTS } from '@nexus/shared/constants';

import { byteLength } from './event-batcher';
import { RetryStorage } from './retry-storage';
import { SDK_NAME, SDK_VERSION, STORAGE_KEYS } from './sdk-info';
import { countStat } from './stats';
import type { DeliveryOutcome } from './transport';
import { createUuid } from './uuid';
import type { BrowserWireBatch } from './wire';

export interface PersistedBatch {
  envelope: BrowserWireBatch;
  /** In-page attempts before it was persisted. */
  attempts: number;
  /** Page loads that already tried to replay it. */
  replays: number;
}

export interface RetryQueueLimits {
  maxBatches: number;
  maxBytes: number;
  ttlMs: number;
  maxReplays: number;
}

export const DEFAULT_RETRY_LIMITS: RetryQueueLimits = {
  maxBatches: SDK_DEFAULTS.browser.retryQueueMaxBatches,
  maxBytes: SDK_DEFAULTS.browser.retryQueueMaxBytes,
  ttlMs: SDK_DEFAULTS.browser.retryQueueTtlMs,
  maxReplays: SDK_DEFAULTS.browser.retryQueueMaxReplays,
};

/** A claim older than this is abandoned (its tab died mid-drain). */
const CLAIM_STALE_MS = 60_000;

type LockManagerLike = {
  request(
    name: string,
    options: { ifAvailable: boolean },
    callback: (lock: unknown) => Promise<void>,
  ): Promise<unknown>;
};

export class PersistentRetryQueue {
  private readonly key: string;
  private readonly owner = createUuid();

  constructor(
    keyScope: string,
    private readonly storage: RetryStorage = new RetryStorage(),
    private readonly limits: RetryQueueLimits = DEFAULT_RETRY_LIMITS,
    private readonly now: () => number = Date.now,
  ) {
    this.key = `${STORAGE_KEYS.retryQueue}:${keyScope}`;
  }

  /** WHY: called after a failed attempt; returns false when the batch could not be kept. */
  persist(envelope: BrowserWireBatch, attempts: number): boolean {
    try {
      const { user: _user, ...withoutUser } = envelope;
      const entry: PersistedBatch = { envelope: withoutUser, attempts, replays: 0 };
      const id = batchId(withoutUser);
      const entries = this.read().filter((e) => batchId(e.envelope) !== id);
      const kept = this.prune([...entries, entry]);
      if (!kept.includes(entry) || !this.write(kept)) {
        countStat('persistFailed');
        return false;
      }
      countStat('persisted');
      return true;
    } catch {
      countStat('persistFailed');
      return false;
    }
  }

  /** WHY: a persisted batch that was delivered in-page after all must not be replayed. */
  forget(envelope: BrowserWireBatch): void {
    try {
      const id = batchId(envelope);
      const entries = this.read();
      const kept = entries.filter((e) => batchId(e.envelope) !== id);
      if (kept.length !== entries.length) this.write(kept);
    } catch {
      // never throw
    }
  }

  /**
   * WHY: replays the queue ONCE per load, in ONE tab at a time (Web Locks, else a claim record).
   * Resolves when done; never rejects.
   */
  async drain(send: (envelope: BrowserWireBatch) => Promise<DeliveryOutcome>): Promise<void> {
    try {
      const locks = webLocks();
      if (locks) {
        await locks.request(`${this.key}:lock`, { ifAvailable: true }, async (lock) => {
          if (lock) await this.drainOwned(send);
        });
        return;
      }
      if (!this.claim()) return;
      try {
        await this.drainOwned(send);
      } finally {
        this.storage.remove(this.claimKey());
      }
    } catch {
      // never throw
    }
  }

  /** WHY: the persisted entries (validated — storage content is untrusted). */
  entries(): PersistedBatch[] {
    return this.read();
  }

  private async drainOwned(send: (envelope: BrowserWireBatch) => Promise<DeliveryOutcome>): Promise<void> {
    const entries = this.prune(this.read());
    this.write(entries);
    for (const entry of entries) {
      const id = batchId(entry.envelope);
      if (entry.replays >= this.limits.maxReplays) {
        countStat('droppedReplayCap');
        this.remove(id);
        continue;
      }
      // Count the replay BEFORE sending, so a tab that dies mid-request still uses one up.
      this.update(id, { ...entry, replays: entry.replays + 1 });
      const outcome = await send(this.replayEnvelope(entry.envelope));
      if (outcome === 'delivered') {
        countStat('replayed');
        this.remove(id);
      } else if (outcome === 'drop') {
        this.remove(id);
      } else {
        // retry / retry_opaque: keep it for the next load; disabled: the kill already purged.
        return;
      }
    }
  }

  private replayEnvelope(envelope: BrowserWireBatch): BrowserWireBatch {
    const client = envelope.client ?? { sdk: SDK_NAME, version: SDK_VERSION };
    return {
      ...envelope,
      sentAt: new Date(this.now()).toISOString(),
      client: { ...client, replay: true },
    };
  }

  /** WHY: TTL first, then the batch count, then the byte budget (oldest out first). */
  private prune(entries: PersistedBatch[]): PersistedBatch[] {
    const now = this.now();
    const kept = entries.filter((entry) => {
      const oldest = oldestOccurredAt(entry.envelope);
      if (oldest !== undefined && now - oldest <= this.limits.ttlMs) return true;
      countStat('expired');
      return false;
    });
    while (kept.length > this.limits.maxBatches) {
      kept.shift();
      countStat('droppedOverflow');
    }
    while (kept.length > 0 && byteLength(JSON.stringify(kept)) > this.limits.maxBytes) {
      kept.shift();
      countStat('droppedOverflow');
    }
    return kept;
  }

  private remove(id: string): void {
    this.write(this.read().filter((e) => batchId(e.envelope) !== id));
  }

  private update(id: string, next: PersistedBatch): void {
    this.write(this.read().map((e) => (batchId(e.envelope) === id ? next : e)));
  }

  private read(): PersistedBatch[] {
    try {
      const raw = this.storage.get(this.key);
      if (!raw) return [];
      const value = JSON.parse(raw) as unknown;
      return Array.isArray(value) ? value.filter(isPersistedBatch) : [];
    } catch {
      return [];
    }
  }

  /** WHY: an empty queue removes the key (no clutter in the host's storage). */
  private write(entries: PersistedBatch[]): boolean {
    if (entries.length === 0) {
      this.storage.remove(this.key);
      return true;
    }
    return this.storage.set(this.key, JSON.stringify(entries));
  }

  /** WHY: Web Locks are missing in older browsers — a claim record that goes stale after 60 s. */
  private claim(): boolean {
    const now = this.now();
    try {
      const raw = this.storage.get(this.claimKey());
      if (raw) {
        const current = JSON.parse(raw) as { owner?: unknown; at?: unknown };
        const fresh = typeof current.at === 'number' && now - current.at < CLAIM_STALE_MS;
        if (fresh && current.owner !== this.owner) return false;
      }
    } catch {
      // a corrupt claim is ignored
    }
    if (!this.storage.set(this.claimKey(), JSON.stringify({ owner: this.owner, at: now }))) return false;
    try {
      const check = JSON.parse(this.storage.get(this.claimKey()) ?? '{}') as { owner?: unknown };
      return check.owner === this.owner;
    } catch {
      return false;
    }
  }

  private claimKey(): string {
    return `${this.key}:claim`;
  }
}

/** WHY: the first event id identifies a batch (ids are UUIDs, a batch never repeats one). */
function batchId(envelope: BrowserWireBatch): string {
  return envelope.events[0]?.eventId ?? '';
}

function oldestOccurredAt(envelope: BrowserWireBatch): number | undefined {
  let oldest: number | undefined;
  for (const event of envelope.events) {
    const at = Date.parse(event.occurredAt);
    if (!Number.isFinite(at)) return undefined;
    if (oldest === undefined || at < oldest) oldest = at;
  }
  return oldest;
}

function isPersistedBatch(value: unknown): value is PersistedBatch {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<PersistedBatch>;
  const envelope = entry.envelope as Partial<BrowserWireBatch> | undefined;
  return (
    typeof entry.attempts === 'number' &&
    typeof entry.replays === 'number' &&
    !!envelope &&
    typeof envelope.key === 'string' &&
    typeof envelope.sessionId === 'string' &&
    Array.isArray(envelope.events) &&
    envelope.events.length > 0
  );
}

function webLocks(): LockManagerLike | undefined {
  try {
    const locks = (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks;
    return locks && typeof locks.request === 'function' ? locks : undefined;
  } catch {
    return undefined;
  }
}
