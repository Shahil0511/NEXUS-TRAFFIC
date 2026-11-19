/**
 * Test harness for the tracker (NOT part of the published bundle — no entry imports it).
 *
 * WHY: every behaviour test needs the same fakes: a capturing `sendBeacon` (unload sends), a
 * capturing `fetch` (live sends and the remote-config request), a synchronous Blob, a
 * controllable `document.visibilityState`, fake timers, and a clean globalThis registry.
 */
import { cleanup } from '@testing-library/react';
import { vi } from 'vitest';

import type { BrowserWireBatch, BrowserWireEvent } from './core/wire';

export const TEST_URL = 'https://nexus.libas.in/traffic';
export const TEST_INGEST_URL = 'https://nexus.libas.in/traffic/api/v1/ingest/browser';
export const TEST_CONFIG_URL = 'https://nexus.libas.in/traffic/api/v1/ingest/config';
export const TEST_KEY = 'nx_pk_test_0123456789';
export const TEST_SCOPE = TEST_KEY.slice(0, 14);
export const START = new Date('2026-10-01T09:00:00.000Z');

/** WHY: jsdom's Blob is async to read; this one keeps the parts so assertions stay synchronous. */
class SyncBlob {
  constructor(
    readonly parts: string[],
    readonly options: { type?: string } = {},
  ) {}
  get type(): string {
    return this.options.type ?? '';
  }
}

export interface SentBatch {
  via: 'beacon' | 'fetch';
  url: string;
  body: string;
}

export type FakeResponder = () => Response | Promise<Response>;

export interface Harness {
  beacon: ReturnType<typeof vi.fn>;
  /** The fake global fetch (ingest + config + anything else → `{}`). */
  fetch: ReturnType<typeof vi.fn>;
  setVisibility(state: 'visible' | 'hidden'): void;
  /** Every batch sent to the ingest URL, by beacon or fetch, in order. */
  sent(): SentBatch[];
  batches(): BrowserWireBatch[];
  rawBodies(): string[];
  events(): BrowserWireEvent[];
  /** Bodies of the remote-config requests. */
  configRequests(): unknown[];
  respondToIngest(responder: FakeResponder): void;
  respondToConfig(responder: FakeResponder): void;
  /** Advance past the flush interval so queued events are sent (and their promises settle). */
  flushByTimer(): Promise<void>;
  /** Let pending promises settle without moving the clock much. */
  settle(): Promise<void>;
  teardown(): void;
}

export const DEFAULT_REMOTE_CONFIG = {
  contract: 1,
  version: 1,
  enabled: true,
  disabledModules: [] as string[],
  maxAgeMs: 300_000,
};

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function setupHarness(): Harness {
  vi.useFakeTimers({
    now: START,
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  resetGlobalState();
  try {
    window.sessionStorage.clear();
    window.localStorage.clear();
  } catch {
    // storage may be stubbed by a test
  }
  vi.stubGlobal('Blob', SyncBlob);

  let visibility: 'visible' | 'hidden' = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });

  const sent: SentBatch[] = [];
  const configBodies: unknown[] = [];
  let ingest: FakeResponder = () => new Response(null, { status: 202 });
  let config: FakeResponder = () => jsonResponse(200, DEFAULT_REMOTE_CONFIG);

  const beacon = vi.fn((url: string, body: unknown) => {
    sent.push({ via: 'beacon', url, body: (body as SyncBlob).parts.join('') });
    return true;
  });
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beacon, writable: true });

  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === TEST_INGEST_URL) {
      sent.push({ via: 'fetch', url, body: String(init?.body) });
      return Promise.resolve(ingest());
    }
    if (url === TEST_CONFIG_URL) {
      configBodies.push(JSON.parse(String(init?.body)));
      return Promise.resolve(config());
    }
    return Promise.resolve(new Response('{}'));
  });
  vi.stubGlobal('fetch', fetchMock);

  const rawBodies = (): string[] => sent.map((s) => s.body);

  return {
    beacon,
    fetch: fetchMock,
    setVisibility(state) {
      visibility = state;
      document.dispatchEvent(new Event('visibilitychange'));
    },
    sent: () => [...sent],
    rawBodies,
    batches: () => rawBodies().map((body) => JSON.parse(body) as BrowserWireBatch),
    events: () => rawBodies().flatMap((body) => (JSON.parse(body) as BrowserWireBatch).events),
    configRequests: () => [...configBodies],
    respondToIngest(responder) {
      ingest = responder;
    },
    respondToConfig(responder) {
      config = responder;
    },
    flushByTimer: () => vi.advanceTimersByTimeAsync(5000).then(() => undefined),
    settle: () => vi.advanceTimersByTimeAsync(0).then(() => undefined),
    teardown() {
      cleanup();
      vi.advanceTimersByTime(1); // run the deferred tracker stop
      resetGlobalState();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    },
  };
}

export function resetGlobalState(): void {
  const holder = globalThis as unknown as Record<symbol, unknown>;
  const state = holder[Symbol.for('@nexus/react/state@2')] as
    | { fetchPatch?: { original: typeof fetch } | null; xhrPatch?: { proto: Record<string, unknown>; original: Record<string, unknown> } | null }
    | undefined;
  // Undo patches a test left behind, so the next test starts from the real globals.
  if (state?.fetchPatch) window.fetch = state.fetchPatch.original;
  if (state?.xhrPatch) Object.assign(state.xhrPatch.proto, state.xhrPatch.original);
  delete holder[Symbol.for('@nexus/react/state@2')];
}
