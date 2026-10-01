/**
 * Test harness for the tracker (NOT part of the published bundle — no entry imports it).
 *
 * WHY: every behaviour test needs the same fakes: a capturing `sendBeacon`, a synchronous Blob, a
 * controllable `document.visibilityState`, fake timers, and a clean globalThis registry.
 */
import { cleanup } from '@testing-library/react';
import { vi } from 'vitest';

import type { BrowserWireBatch, BrowserWireEvent } from './core/wire';

export const TEST_URL = 'https://nexus.libas.in/traffic';
export const TEST_INGEST_URL = 'https://nexus.libas.in/traffic/api/v1/ingest/browser';
export const TEST_KEY = 'nx_pk_test_0123456789';
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

export interface Harness {
  beacon: ReturnType<typeof vi.fn>;
  setVisibility(state: 'visible' | 'hidden'): void;
  batches(): BrowserWireBatch[];
  rawBodies(): string[];
  events(): BrowserWireEvent[];
  /** Advance past the flush interval so queued events are sent. */
  flushByTimer(): void;
  teardown(): void;
}

export function setupHarness(): Harness {
  vi.useFakeTimers({ now: START, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
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

  const beacon = vi.fn((_url: string, _body: unknown) => true);
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beacon, writable: true });

  const rawBodies = (): string[] =>
    beacon.mock.calls.map((call) => (call[1] as SyncBlob).parts.join(''));

  return {
    beacon,
    setVisibility(state) {
      visibility = state;
      document.dispatchEvent(new Event('visibilitychange'));
    },
    rawBodies,
    batches: () => rawBodies().map((body) => JSON.parse(body) as BrowserWireBatch),
    events: () => rawBodies().flatMap((body) => (JSON.parse(body) as BrowserWireBatch).events),
    flushByTimer: () => vi.advanceTimersByTime(5000),
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
  delete (globalThis as unknown as Record<symbol, unknown>)[Symbol.for('@nexus/react/state')];
}
