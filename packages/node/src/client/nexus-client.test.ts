import { INGEST_HEADERS, SDK_DEFAULTS } from '@nexus/shared/constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventId } from '../event-id';
import type { NexusClientOptions, NexusServerBatch, NexusServerEvent } from '../types';
import { createNexusClient } from './nexus-client';

// ─── Helpers ────────────────────────────────────────────────────────────────

const URL_BASE = 'https://nexus.example.test/traffic';
const ENDPOINT = `${URL_BASE}/api/v1/ingest/server`;

interface Call {
  url: string;
  init: RequestInit;
  body: NexusServerBatch;
}

type Responder = (body: NexusServerBatch, call: number, init: RequestInit) => Response | Promise<Response>;

function fakeFetch(responder: Responder) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as NexusServerBatch;
    calls.push({ url, init, body });
    return responder(body, calls.length, init);
  });
  return { fn, calls };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function accepted(count: number, rejected = 0): Response {
  return json(202, {
    accepted: count - rejected,
    duplicates: 0,
    rejected: Array.from({ length: rejected }, (_, index) => ({ index, code: 'INVALID_EVENT', message: 'x' })),
    warnings: [],
  });
}

function errorBody(status: number, code: string, headers: Record<string, string> = {}): Response {
  return json(status, { error: { code, message: code, requestId: 'r1' } }, headers);
}

function makeEvent(index = 0, extra: Partial<NexusServerEvent> = {}): NexusServerEvent {
  return {
    eventId: createEventId(),
    occurredAt: new Date().toISOString(),
    method: 'GET',
    path: `/app/items/${index}`,
    status: 200,
    durationMs: 1.5,
    ...extra,
  };
}

function quietLogger() {
  return { warn: vi.fn(), error: vi.fn() };
}

function client(responder: Responder, options: Partial<NexusClientOptions> = {}) {
  const fetch = fakeFetch(responder);
  const logger = quietLogger();
  const nexus = createNexusClient({ url: URL_BASE, key: 'nx_sk_test', fetch: fetch.fn, logger, ...options });
  return { nexus, fetch, logger };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-01T09:30:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Configuration ──────────────────────────────────────────────────────────

describe('createNexusClient configuration', () => {
  it.each([
    ['no url', { key: 'k' }],
    ['no key', { url: URL_BASE }],
    ['empty url', { url: '  ', key: 'k' }],
    ['disabled', { url: URL_BASE, key: 'k', disabled: true }],
  ])('is a silent no-op with %s', async (_label, options: NexusClientOptions) => {
    const fetch = fakeFetch(() => accepted(1));
    const logger = quietLogger();
    const nexus = createNexusClient({ ...options, fetch: fetch.fn, logger });
    nexus.track(makeEvent());
    await nexus.flush();
    await nexus.shutdown();
    expect(fetch.fn).not.toHaveBeenCalled();
    expect(nexus.stats()).toMatchObject({ enabled: false, queued: 0 });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('falls back to a no-op client on a malformed URL instead of throwing', () => {
    const logger = quietLogger();
    const nexus = createNexusClient({ url: 'not a url', key: 'k', logger });
    expect(nexus.stats().enabled).toBe(false);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('warns once about a plain http:// URL that is not localhost', () => {
    const logger = quietLogger();
    createNexusClient({ url: 'http://nexus.internal/traffic', key: 'k', logger, fetch: vi.fn() });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(String(logger.error.mock.calls[0]?.[0])).toContain('http://');
  });

  it.each(['http://localhost:8080/traffic', 'http://127.0.0.1/traffic', 'https://nexus.libas.in/traffic'])(
    'does not warn for %s',
    (url) => {
      const logger = quietLogger();
      createNexusClient({ url, key: 'k', logger, fetch: vi.fn() });
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    },
  );

  it('exposes trustProxyHops (default 1) and the sdk identity', () => {
    expect(createNexusClient({}).trustProxyHops).toBe(1);
    expect(createNexusClient({ trustProxyHops: 2 }).trustProxyHops).toBe(2);
    expect(createNexusClient({ trustProxyHops: 0 }).trustProxyHops).toBe(0);
    expect(createNexusClient({}).sdk).toEqual({ name: '@nexus/node', version: '1.0.0' });
  });
});

// ─── Request shape ──────────────────────────────────────────────────────────

describe('request shape', () => {
  it('POSTs the envelope to buildIngestUrl(url, ROUTES.ingest.server) with the contract headers', async () => {
    const { nexus, fetch } = client((body) => accepted(body.events.length), { url: `${URL_BASE}/` });
    const event = makeEvent();
    nexus.track(event);
    await nexus.flush();
    expect(fetch.calls).toHaveLength(1);
    const call = fetch.calls[0]!;
    expect(call.url).toBe(ENDPOINT);
    expect(call.init.method).toBe('POST');
    expect(call.init.redirect).toBe('manual');
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
    const headers = call.init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers[INGEST_HEADERS.key]).toBe('nx_sk_test');
    expect(headers[INGEST_HEADERS.sdk]).toBe('@nexus/node@1.0.0');
    expect(call.body).toEqual({
      sentAt: '2026-10-01T09:30:00.000Z',
      sdk: { name: '@nexus/node', version: '1.0.0' },
      events: [event],
    });
  });

  it('reports an adapter sdk identity when given one', async () => {
    const { nexus, fetch } = client(() => accepted(1), { sdk: { name: '@nexus/express', version: '1.0.0' } });
    nexus.track(makeEvent());
    await nexus.flush();
    expect((fetch.calls[0]!.init.headers as Record<string, string>)[INGEST_HEADERS.sdk]).toBe('@nexus/express@1.0.0');
    expect(fetch.calls[0]!.body.sdk).toEqual({ name: '@nexus/express', version: '1.0.0' });
  });
});

// ─── Flush triggers ─────────────────────────────────────────────────────────

describe('flush triggers', () => {
  it('flushes when flushEvents events are queued', async () => {
    const { nexus, fetch } = client((body) => accepted(body.events.length), { flushEvents: 3 });
    nexus.track(makeEvent(1));
    nexus.track(makeEvent(2));
    expect(fetch.fn).not.toHaveBeenCalled();
    nexus.track(makeEvent(3));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0]!.body.events).toHaveLength(3);
  });

  it('flushes every flushIntervalMs', async () => {
    const { nexus, fetch } = client((body) => accepted(body.events.length), { flushIntervalMs: 1000 });
    nexus.track(makeEvent());
    await vi.advanceTimersByTimeAsync(999);
    expect(fetch.fn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch.calls).toHaveLength(1);
    expect(nexus.stats()).toMatchObject({ queued: 0, accepted: 1 });
  });

  it('uses the documented defaults (100 events / 5 s)', async () => {
    const { nexus, fetch } = client((body) => accepted(body.events.length));
    for (let i = 0; i < SDK_DEFAULTS.server.flushEvents - 1; i += 1) nexus.track(makeEvent(i));
    await vi.advanceTimersByTimeAsync(SDK_DEFAULTS.server.flushIntervalMs - 1);
    expect(fetch.fn).not.toHaveBeenCalled();
    nexus.track(makeEvent());
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch.calls[0]!.body.events).toHaveLength(SDK_DEFAULTS.server.flushEvents);
  });
});

// ─── Queue and batching ─────────────────────────────────────────────────────

describe('queue and batching', () => {
  it('drops the OLDEST events when the queue is full and counts them', async () => {
    const { nexus, fetch } = client((body) => accepted(body.events.length), { maxQueue: 3 });
    const events = [1, 2, 3, 4, 5].map((i) => makeEvent(i));
    for (const event of events) nexus.track(event);
    expect(nexus.stats()).toMatchObject({ queued: 3, dropped: 2 });
    await nexus.flush();
    expect(fetch.calls[0]!.body.events.map((e) => e.path)).toEqual(['/app/items/3', '/app/items/4', '/app/items/5']);
  });

  it('never sends more than INGEST_LIMITS.server.maxEvents per request', async () => {
    const { nexus, fetch } = client((body) => accepted(body.events.length), { flushEvents: 10_000 });
    for (let i = 0; i < 1200; i += 1) nexus.track(makeEvent(i));
    await nexus.flush();
    expect(fetch.calls.map((c) => c.body.events.length)).toEqual([500, 500, 200]);
    expect(nexus.stats()).toMatchObject({ accepted: 1200, queued: 0 });
  });

  it('splits by body size before sending and drops a single event that can never fit', async () => {
    const { nexus, fetch } = client((body) => accepted(body.events.length), { flushEvents: 10_000 });
    const userAgent = 'u'.repeat(4000);
    for (let i = 0; i < 200; i += 1) nexus.track(makeEvent(i, { userAgent }));
    nexus.track(makeEvent(999, { path: `/${'p'.repeat(600 * 1024)}` }));
    await nexus.flush();
    expect(fetch.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of fetch.calls) {
      expect(new TextEncoder().encode(call.init.body as string).length).toBeLessThanOrEqual(512 * 1024);
    }
    expect(fetch.calls.reduce((n, c) => n + c.body.events.length, 0)).toBe(200);
    expect(nexus.stats().dropped).toBe(1);
  });
});

// ─── Response branches ──────────────────────────────────────────────────────

describe('response handling (guide chapter 4)', () => {
  it('202: done, never retried, rejected[] counted', async () => {
    const { nexus, fetch } = client((body) => accepted(body.events.length, 1));
    nexus.track(makeEvent(1));
    nexus.track(makeEvent(2));
    await nexus.flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetch.calls).toHaveLength(1);
    expect(nexus.stats()).toMatchObject({ accepted: 1, rejected: 1, dropped: 0, queued: 0 });
  });

  it.each([
    [400, 'INVALID_ENVELOPE'],
    [415, 'UNSUPPORTED_MEDIA_TYPE'],
    [404, 'NOT_FOUND'],
  ])('%s: drops the batch without retrying', async (status, code) => {
    const { nexus, fetch } = client(() => errorBody(status, code));
    nexus.track(makeEvent());
    await nexus.flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetch.calls).toHaveLength(1);
    expect(nexus.stats()).toMatchObject({ dropped: 1, queued: 0, paused: false });
  });

  it.each([
    [401, 'INVALID_API_KEY'],
    [403, 'WRONG_KEY_TYPE'],
  ])('%s: keeps the events and pauses sending for authPauseMs', async (status, code) => {
    let refuse = true;
    const { nexus, fetch } = client((body) => (refuse ? errorBody(status, code) : accepted(body.events.length)));
    const event = makeEvent();
    nexus.track(event);
    await nexus.flush();
    expect(nexus.stats()).toMatchObject({ queued: 1, dropped: 0, paused: true });
    nexus.track(makeEvent(2));
    await nexus.flush();
    expect(fetch.calls).toHaveLength(1); // paused: nothing sent
    refuse = false;
    await vi.advanceTimersByTimeAsync(SDK_DEFAULTS.retry.authPauseMs + SDK_DEFAULTS.server.flushIntervalMs);
    expect(fetch.calls).toHaveLength(2);
    expect(fetch.calls[1]!.body.events[0]).toEqual(event); // same event, original order
    expect(nexus.stats()).toMatchObject({ queued: 0, accepted: 2, paused: false });
  });

  it('413: halves the batch recursively until it fits', async () => {
    const { nexus, fetch } = client((body) =>
      body.events.length > 2 ? errorBody(413, 'PAYLOAD_TOO_LARGE') : accepted(body.events.length),
    );
    for (let i = 0; i < 8; i += 1) nexus.track(makeEvent(i));
    await nexus.flush();
    expect(fetch.calls.map((c) => c.body.events.length)).toEqual([8, 4, 2, 2, 4, 2, 2]);
    expect(nexus.stats()).toMatchObject({ accepted: 8, dropped: 0 });
  });

  it('413 on a single event: drops it', async () => {
    const { nexus, fetch } = client(() => errorBody(413, 'PAYLOAD_TOO_LARGE'));
    nexus.track(makeEvent());
    await nexus.flush();
    expect(fetch.calls).toHaveLength(1);
    expect(nexus.stats().dropped).toBe(1);
  });

  it.each([429, 503])('%s: waits Retry-After seconds, then resends the same events', async (status) => {
    const { nexus, fetch } = client((body, call) =>
      call === 1 ? errorBody(status, 'RATE_LIMITED', { 'retry-after': '2' }) : accepted(body.events.length),
    );
    nexus.track(makeEvent());
    const done = nexus.flush();
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetch.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(fetch.calls).toHaveLength(2);
    expect(fetch.calls[1]!.body.events).toEqual(fetch.calls[0]!.body.events);
    expect(nexus.stats()).toMatchObject({ accepted: 1, dropped: 0 });
  });

  it('5xx: backs off 1 s then 2 s (±20 %), gives up after 3 attempts and drops', async () => {
    const { nexus, fetch } = client(() => errorBody(500, 'INTERNAL'));
    nexus.track(makeEvent());
    const done = nexus.flush();
    await vi.advanceTimersByTimeAsync(799);
    expect(fetch.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1201 - 799);
    expect(fetch.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2400 + 1);
    await done;
    expect(fetch.calls).toHaveLength(3);
    expect(nexus.stats()).toMatchObject({ dropped: 1, attempts: 3, queued: 0 });
  });

  it('a gateway HTML 502 is a transient error, not a proxy interception', async () => {
    const { nexus, fetch, logger } = client((body, call) =>
      call === 1
        ? new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } })
        : accepted(body.events.length),
    );
    nexus.track(makeEvent());
    const done = nexus.flush();
    await vi.advanceTimersByTimeAsync(1300);
    await done;
    expect(fetch.calls).toHaveLength(2);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('network error: retries with backoff', async () => {
    const { nexus, fetch } = client((body, call) => {
      if (call === 1) throw new TypeError('fetch failed');
      return accepted(body.events.length);
    });
    nexus.track(makeEvent());
    const done = nexus.flush();
    await vi.advanceTimersByTimeAsync(1300);
    await done;
    expect(fetch.calls).toHaveLength(2);
    expect(nexus.stats()).toMatchObject({ accepted: 1, dropped: 0 });
  });

  it('timeout: aborts after requestTimeoutMs and retries', async () => {
    const { nexus, fetch } = client(
      (body, call, init) =>
        call === 1
          ? new Promise<Response>((_resolve, reject) => {
              init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            })
          : accepted(body.events.length),
      { requestTimeoutMs: 500 },
    );
    nexus.track(makeEvent());
    const done = nexus.flush();
    await vi.advanceTimersByTimeAsync(499);
    expect(fetch.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1 + 1300);
    await done;
    expect(fetch.calls).toHaveLength(2);
    expect(nexus.stats().accepted).toBe(1);
  });

  it.each([
    ['302 redirect', () => new Response(null, { status: 302, headers: { location: 'https://sso.example/login' } })],
    ['200 HTML page', () => new Response('<html>login</html>', { status: 200, headers: { 'content-type': 'text/html' } })],
    ['401 non-JSON', () => new Response('Unauthorized', { status: 401, headers: { 'content-type': 'text/plain' } })],
  ])('%s: proxy interception → drop, pause and ONE loud log', async (_label, respond) => {
    const { nexus, fetch, logger } = client(() => respond());
    nexus.track(makeEvent(1));
    await nexus.flush();
    expect(nexus.stats()).toMatchObject({ dropped: 1, paused: true, queued: 0 });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(String(logger.error.mock.calls[0]?.[0])).toContain('ingest URL is intercepted by a proxy');
    await vi.advanceTimersByTimeAsync(SDK_DEFAULTS.retry.authPauseMs + SDK_DEFAULTS.server.flushIntervalMs);
    nexus.track(makeEvent(2));
    await nexus.flush();
    expect(fetch.calls).toHaveLength(2);
    expect(logger.error).toHaveBeenCalledTimes(1); // once, not per batch
  });

  it('re-stamps sentAt on every attempt while events stay identical', async () => {
    const { nexus, fetch } = client((body, call) => (call === 1 ? errorBody(500, 'X') : accepted(body.events.length)));
    nexus.track(makeEvent());
    const done = nexus.flush();
    await vi.advanceTimersByTimeAsync(1300);
    await done;
    const [first, second] = fetch.calls;
    expect(second!.body.sentAt).not.toBe(first!.body.sentAt);
    expect(Date.parse(second!.body.sentAt)).toBeGreaterThan(Date.parse(first!.body.sentAt));
    expect(second!.body.events).toEqual(first!.body.events);
  });
});

// ─── Never throws ───────────────────────────────────────────────────────────

describe('never throws into the host app', () => {
  it('survives a fetch that throws synchronously, a throwing logger and unserializable events', async () => {
    const fetch = vi.fn(() => {
      throw new Error('boom');
    });
    const logger = {
      warn: () => {
        throw new Error('logger down');
      },
    };
    const nexus = createNexusClient({ url: URL_BASE, key: 'k', fetch, logger });
    const circular = makeEvent() as NexusServerEvent & { self?: unknown };
    circular.self = circular;
    expect(() => nexus.track(circular)).not.toThrow();
    expect(() => nexus.track(undefined as unknown as NexusServerEvent)).not.toThrow();
    nexus.track(makeEvent());
    const done = nexus.flush();
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(done).resolves.toBeUndefined();
    expect(() => nexus.stats()).not.toThrow();
    await expect(nexus.shutdown()).resolves.toBeUndefined();
  });

  it('shutdown flushes pending events', async () => {
    const { nexus, fetch } = client((body) => accepted(body.events.length));
    nexus.track(makeEvent());
    await nexus.shutdown();
    expect(fetch.calls).toHaveLength(1);
    nexus.track(makeEvent()); // after shutdown: ignored
    expect(nexus.stats().queued).toBe(0);
  });

  it('shutdown resolves at its deadline even when the collector hangs', async () => {
    const { nexus } = client(() => new Promise<Response>(() => undefined), { requestTimeoutMs: 60_000 });
    nexus.track(makeEvent());
    let resolved = false;
    void nexus.shutdown(1000).then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
  });
});
