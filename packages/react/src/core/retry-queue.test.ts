import { SDK_DEFAULTS } from '@nexus/shared/constants';
import { browserIngestBatchSchema } from '@nexus/shared/ingest';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  jsonResponse,
  resetGlobalState,
  setupHarness,
  TEST_KEY,
  TEST_SCOPE,
  TEST_URL,
  type Harness,
} from '../test-harness';
import { useNexusTracker, type UseNexusTrackerOptions } from '../use-nexus-tracker';
import { BatchSender } from './batch-sender';
import { globalState } from './global-state';
import { PersistentRetryQueue, type RetryQueueLimits } from './retry-queue';
import { RetryStorage } from './retry-storage';
import { pruneStaleScopes } from './stale-scopes';
import { getNexusStats } from './stats';
import { defaultTransport, type DeliveryOutcome, type Transport } from './transport';
import type { BrowserWireBatch } from './wire';

let h: Harness;
beforeEach(() => {
  h = setupHarness();
});
afterEach(() => {
  h.teardown();
});

const QUEUE_KEY = `nexus.retry:${TEST_SCOPE}`;

function envelope(n: number, occurredAt = new Date().toISOString(), label = ''): BrowserWireBatch {
  return {
    key: TEST_KEY,
    sentAt: occurredAt,
    sessionId: '5b0d6f7e-2a3c-4d1e-9f8a-7b6c5d4e3f21',
    user: { email: 'someone@libas.in' },
    client: { sdk: '@nexus/react', version: '1.1.0' },
    events: [
      {
        type: 'custom',
        name: 'x.y',
        eventId: `0b8f6c1e-5a2d-4c4f-9a51-${String(n).padStart(12, '0')}`,
        occurredAt,
        seq: n,
        path: '/a',
        ...(label ? { label } : {}),
      },
    ],
  };
}

const LIMITS: RetryQueueLimits = { maxBatches: 20, maxBytes: 128 * 1024, ttlMs: 24 * 3600_000, maxReplays: 3 };

describe('PersistentRetryQueue', () => {
  it('persists WITHOUT user and replays with replay:true, a fresh sentAt and the same ids', async () => {
    const queue = new PersistentRetryQueue(TEST_SCOPE);
    const original = envelope(1);
    expect(queue.persist(original, 3)).toBe(true);
    expect(window.localStorage.getItem(QUEUE_KEY)).not.toContain('someone@libas.in');

    vi.advanceTimersByTime(60_000);
    const sent: BrowserWireBatch[] = [];
    await queue.drain(async (e) => {
      sent.push(e);
      return 'delivered';
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.user).toBeUndefined();
    expect(sent[0]!.client).toMatchObject({ replay: true });
    expect(sent[0]!.events).toEqual(original.events);
    expect(sent[0]!.sentAt).not.toBe(original.sentAt);
    expect(browserIngestBatchSchema.safeParse(sent[0]).success).toBe(true);
    expect(queue.entries()).toEqual([]);
    expect(window.localStorage.getItem(QUEUE_KEY)).toBeNull();
    expect(getNexusStats()).toMatchObject({ persisted: 1, replayed: 1 });
  });

  it('expires batches older than the TTL (by the oldest occurredAt)', async () => {
    const queue = new PersistentRetryQueue(TEST_SCOPE, new RetryStorage(), LIMITS);
    queue.persist(envelope(1), 1);
    vi.advanceTimersByTime(LIMITS.ttlMs + 1);
    const send = vi.fn(async (): Promise<DeliveryOutcome> => 'delivered');
    await queue.drain(send);
    expect(send).not.toHaveBeenCalled();
    expect(getNexusStats().expired).toBe(1);
  });

  it('keeps the queue within the byte bound, dropping the oldest', () => {
    const limits = { ...LIMITS, maxBytes: 2000 };
    const queue = new PersistentRetryQueue(TEST_SCOPE, new RetryStorage(), limits);
    for (let i = 0; i < 10; i++) queue.persist(envelope(i, undefined, 'l'.repeat(100)), 1);
    const raw = window.localStorage.getItem(QUEUE_KEY)!;
    expect(new TextEncoder().encode(raw).length).toBeLessThanOrEqual(2000);
    const kept = queue.entries().map((e) => e.envelope.events[0]!.seq);
    expect(kept.at(-1)).toBe(9);
    expect(kept[0]).toBeGreaterThan(0);
  });

  it('keeps at most maxBatches', () => {
    const queue = new PersistentRetryQueue(TEST_SCOPE, new RetryStorage(), { ...LIMITS, maxBatches: 3 });
    for (let i = 0; i < 5; i++) queue.persist(envelope(i), 1);
    expect(queue.entries().map((e) => e.envelope.events[0]!.seq)).toEqual([2, 3, 4]);
  });

  it('drops a batch after 3 replays without delivery', async () => {
    const queue = new PersistentRetryQueue(TEST_SCOPE);
    queue.persist(envelope(1), 3);
    const send = vi.fn(async (): Promise<DeliveryOutcome> => 'retry');
    for (let load = 0; load < 4; load++) await queue.drain(send);
    expect(send).toHaveBeenCalledTimes(3);
    expect(queue.entries()).toEqual([]);
    expect(getNexusStats().droppedReplayCap).toBe(1);
  });

  it('a quota error drops the batch and counts persistFailed — no memory fallback', () => {
    const backing = new Map<string, string>();
    const storage = new RetryStorage(
      () =>
        ({
          getItem: (k: string) => backing.get(k) ?? null,
          setItem: () => {
            throw new DOMException('full', 'QuotaExceededError');
          },
          removeItem: (k: string) => backing.delete(k),
        }) as unknown as Storage,
    );
    const queue = new PersistentRetryQueue(TEST_SCOPE, storage);
    expect(queue.persist(envelope(1), 3)).toBe(false);
    expect(queue.entries()).toEqual([]);
    expect(getNexusStats()).toMatchObject({ persistFailed: 1, persisted: 0 });
  });

  it('only one tab drains at a time (claim record)', async () => {
    const queue = new PersistentRetryQueue(TEST_SCOPE);
    queue.persist(envelope(1), 1);
    window.localStorage.setItem(`${QUEUE_KEY}:claim`, JSON.stringify({ owner: 'other-tab', at: Date.now() }));
    const send = vi.fn(async (): Promise<DeliveryOutcome> => 'delivered');
    await queue.drain(send);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(61_000); // the other tab's claim went stale
    await queue.drain(send);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('BatchSender', () => {
  function sender(outcomes: DeliveryOutcome[]) {
    const transport = vi.fn<Transport>(async () => outcomes.shift() ?? 'delivered');
    const persist = vi.fn((_json: string, _attempts: number) => true);
    const forget = vi.fn();
    const onDisabled = vi.fn();
    return {
      transport,
      persist,
      forget,
      onDisabled,
      s: new BatchSender({ url: 'u', transport, persist, forget, onDisabled }),
    };
  }

  it('400/413/415 are dropped, never persisted', async () => {
    const t = sender(['drop']);
    t.s.send('{}', 'live');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.transport).toHaveBeenCalledTimes(1);
    expect(t.persist).not.toHaveBeenCalled();
  });

  it('5xx backs off, then persists after maxAttempts', async () => {
    const t = sender(['retry', 'retry', 'retry']);
    t.s.send('{}', 'live');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.transport).toHaveBeenCalledTimes(3);
    expect(t.persist).toHaveBeenCalledTimes(1);
    expect(t.persist).toHaveBeenCalledWith('{}', 3);
  });

  it('an opaque failure is persisted ONCE, and forgotten if a later retry succeeds', async () => {
    const t = sender(['retry_opaque', 'retry_opaque', 'delivered']);
    t.s.send('{}', 'live');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.transport).toHaveBeenCalledTimes(3);
    expect(t.persist).toHaveBeenCalledTimes(1);
    expect(t.forget).toHaveBeenCalledTimes(1);
  });

  it('sends one batch at a time', async () => {
    let release!: (o: DeliveryOutcome) => void;
    const transport = vi.fn<Transport>(() => new Promise((resolve) => (release = resolve)));
    const s = new BatchSender({ url: 'u', transport, persist: () => true, forget: () => undefined, onDisabled: () => undefined });
    s.send('a', 'live');
    s.send('b', 'live');
    expect(transport).toHaveBeenCalledTimes(1);
    release('delivered');
    await vi.advanceTimersByTimeAsync(0);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[1]![1]).toBe('b');
  });

  it('the in-page queue is bounded: beyond maxPending the oldest waiting batch goes to the retry queue', async () => {
    const transport = vi.fn<Transport>(() => new Promise(() => undefined)); // never answers
    const persist = vi.fn((_json: string, _attempts: number) => false);
    const onOverflow = vi.fn();
    const s = new BatchSender({
      url: 'u',
      transport,
      persist,
      forget: () => undefined,
      onDisabled: () => undefined,
      onOverflow,
      maxPending: 3,
    });
    for (const json of ['a', 'b', 'c', 'd', 'e']) s.send(json, 'live');
    expect(s.size()).toBe(3);
    expect(persist.mock.calls.map((c) => c[0])).toEqual(['b', 'c']); // 'a' is in flight
    expect(onOverflow).toHaveBeenCalledTimes(2);
  });

  it('unload persists the IN-FLIGHT batch when it already failed once', async () => {
    let release!: (o: DeliveryOutcome) => void;
    const outcomes: Array<Promise<DeliveryOutcome>> = [
      Promise.resolve('retry'),
      new Promise((resolve) => (release = resolve)),
    ];
    const transport = vi.fn<Transport>(() => outcomes.shift() ?? Promise.resolve('delivered'));
    const persist = vi.fn((_json: string, _attempts: number) => true);
    const forget = vi.fn();
    const s = new BatchSender({ url: 'u', transport, persist, forget, onDisabled: () => undefined });
    s.send('a', 'live');
    await vi.advanceTimersByTimeAsync(5_000); // first attempt 503, retry now in flight
    expect(transport).toHaveBeenCalledTimes(2);
    s.unload();
    expect(persist).toHaveBeenCalledWith('a', 1);
    release('delivered'); // the page survived after all: forgotten again
    await vi.advanceTimersByTimeAsync(0);
    expect(forget).toHaveBeenCalledWith('a');
  });

  it('a kill code stops the sender and reports it', async () => {
    const t = sender(['disabled']);
    t.s.send('{}', 'live');
    await vi.advanceTimersByTimeAsync(0);
    expect(t.onDisabled).toHaveBeenCalledTimes(1);
    expect(t.persist).not.toHaveBeenCalled();
  });
});

describe('defaultTransport timeout', () => {
  it('a live ingest fetch that never answers is aborted after ingestTimeoutMs → retry_opaque', async () => {
    let signal: AbortSignal | undefined;
    globalState().nativeFetch = ((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    }) as unknown as typeof fetch;
    const outcome = defaultTransport('https://nexus.example/ingest', '{}', 'live');
    await vi.advanceTimersByTimeAsync(SDK_DEFAULTS.browser.ingestTimeoutMs);
    await expect(outcome).resolves.toBe('retry_opaque');
    expect(signal?.aborted).toBe(true);
  });
});

describe('pruneStaleScopes', () => {
  const DAY = 24 * 3600_000;
  const queueOf = (occurredAt: string) => JSON.stringify([{ envelope: envelope(1, occurredAt), attempts: 3, replays: 0 }]);

  it("removes OTHER scopes' expired queues, stale claims and stale config caches — never its own", () => {
    const now = Date.now();
    const old = new Date(now - DAY - 60_000).toISOString();
    const fresh = new Date(now - 60_000).toISOString();
    const ls = window.localStorage;
    ls.setItem('nexus.retry:nx_pk_oldscope1', queueOf(old));
    ls.setItem('nexus.retry:nx_pk_oldscope1:claim', JSON.stringify({ owner: 'x', at: now - 120_000 }));
    ls.setItem('nexus.retry:nx_pk_livescope', queueOf(fresh));
    ls.setItem('nexus.config:nx_pk_oldscope1', JSON.stringify({ at: now - 2 * DAY, enabled: true, config: null }));
    ls.setItem('nexus.config:nx_pk_livescope', JSON.stringify({ at: now - 60_000, enabled: true, config: null }));
    ls.setItem(QUEUE_KEY, queueOf(old)); // own scope: left to its owner
    ls.setItem('host.app.key', 'kept');

    pruneStaleScopes(TEST_SCOPE, now);

    expect(ls.getItem('nexus.retry:nx_pk_oldscope1')).toBeNull();
    expect(ls.getItem('nexus.retry:nx_pk_oldscope1:claim')).toBeNull();
    expect(ls.getItem('nexus.config:nx_pk_oldscope1')).toBeNull();
    expect(ls.getItem('nexus.retry:nx_pk_livescope')).not.toBeNull();
    expect(ls.getItem('nexus.config:nx_pk_livescope')).not.toBeNull();
    expect(ls.getItem(QUEUE_KEY)).not.toBeNull();
    expect(ls.getItem('host.app.key')).toBe('kept');
  });

  it('never throws on blocked storage', () => {
    const blocked = {
      get length(): number {
        throw new Error('SecurityError');
      },
    } as unknown as Storage;
    expect(() => pruneStaleScopes(TEST_SCOPE, Date.now(), blocked)).not.toThrow();
  });
});

describe('retry queue end to end (hook)', () => {
  const options: UseNexusTrackerOptions = { url: TEST_URL, publishableKey: TEST_KEY, pathname: '/my-app/a' };

  it('5xx → persisted → replayed on the next load with replay:true and the same eventId/occurredAt', async () => {
    h.respondToIngest(() => jsonResponse(503, { error: { code: 'INTERNAL' } }));
    const first = renderHook((p: UseNexusTrackerOptions) => useNexusTracker(p), {
      initialProps: { ...options, user: { email: 'a@libas.in' } },
    });
    await h.flushByTimer(); // attempt 1
    await vi.advanceTimersByTimeAsync(10_000); // attempts 2 and 3 → persisted
    const failed = h.batches()[0]!;
    expect(h.batches().length).toBeGreaterThanOrEqual(3);
    const stored = window.localStorage.getItem(QUEUE_KEY)!;
    expect(stored).toContain(failed.events[0]!.eventId);
    expect(stored).not.toContain('a@libas.in');
    first.unmount();
    vi.advanceTimersByTime(1);

    // "next page load": fresh in-memory state, same localStorage
    resetGlobalState();
    h.respondToIngest(() => new Response(null, { status: 202 }));
    const before = h.sent().length;
    renderHook((p: UseNexusTrackerOptions) => useNexusTracker(p), { initialProps: options });
    await h.settle();
    const replay = h.batches().slice(before).find((b) => b.client?.replay === true)!;
    expect(replay).toBeDefined();
    expect(replay.events[0]).toMatchObject({
      eventId: failed.events[0]!.eventId,
      occurredAt: failed.events[0]!.occurredAt,
    });
    expect(replay.user).toBeUndefined();
    expect(browserIngestBatchSchema.safeParse(replay).success).toBe(true);
    expect(window.localStorage.getItem(QUEUE_KEY)).toBeNull();
  });

  it('persistRetries: false never writes the queue', async () => {
    h.respondToIngest(() => new Response(null, { status: 500 }));
    renderHook((p: UseNexusTrackerOptions) => useNexusTracker(p), {
      initialProps: { ...options, persistRetries: false },
    });
    await h.flushByTimer();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(window.localStorage.getItem(QUEUE_KEY)).toBeNull();
  });
});
