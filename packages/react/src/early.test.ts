import { INGEST_HEADERS } from '@nexus/shared/constants';
import { renderHook } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeCachedConfig } from './core/config-cache';
import { globalState, sharedSessionStore } from './core/global-state';
import { installNexusEarly } from './early';
import {
  jsonResponse,
  setupHarness,
  TEST_KEY,
  TEST_SCOPE,
  TEST_URL,
  type Harness,
} from './test-harness';
import { useNexusTracker, type UseNexusTrackerOptions } from './use-nexus-tracker';

/** Records every XHR call; enough for the patch (open / setRequestHeader / send). */
class FakeXhr {
  headers: Array<[string, string]> = [];
  open(): void {}
  setRequestHeader(name: string, value: string): void {
    this.headers.push([name, value]);
  }
  send(): void {}
}

let h: Harness;
let appFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  h = setupHarness();
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  // The host app's own API: same-origin calls go here, ingest/config go to the harness fetch.
  appFetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(TEST_URL)) return (h.fetch as unknown as typeof fetch)(input, init);
    return Promise.resolve(new Response('{}'));
  });
  window.fetch = appFetch as unknown as typeof fetch;
});
afterEach(() => {
  h.teardown();
});

const early = (extra: Partial<Parameters<typeof installNexusEarly>[0]> = {}) =>
  installNexusEarly({ url: TEST_URL, publishableKey: TEST_KEY, ...extra });
const mount = (extra: Partial<UseNexusTrackerOptions> = {}) =>
  renderHook((p: UseNexusTrackerOptions) => useNexusTracker(p), {
    initialProps: { url: TEST_URL, publishableKey: TEST_KEY, pathname: '/my-app/a', ...extra },
  });
const lastAppHeaders = () => new Headers(appFetch.mock.calls.at(-1)![1]?.headers);

describe('installNexusEarly', () => {
  it('is a no-op without url/key, when disabled, and never throws', () => {
    const before = window.fetch;
    for (const options of [
      { url: undefined, publishableKey: TEST_KEY },
      { url: TEST_URL, publishableKey: undefined },
      { url: ' ', publishableKey: TEST_KEY },
      { url: TEST_URL, publishableKey: TEST_KEY, disabled: true },
      { url: TEST_URL, publishableKey: TEST_KEY, propagateHeaders: false },
    ]) {
      expect(() => installNexusEarly(options)).not.toThrow();
      expect(window.fetch).toBe(before);
    }
    expect(() => installNexusEarly(null as never)).not.toThrow();
  });

  it('is a no-op when the cache says killed or header_propagation is off', () => {
    const before = window.fetch;
    writeCachedConfig(TEST_SCOPE, { at: Date.now(), enabled: false, config: null });
    early();
    expect(window.fetch).toBe(before);
    writeCachedConfig(TEST_SCOPE, {
      at: Date.now(),
      enabled: true,
      config: { contract: 1, version: 2, enabled: true, disabledModules: ['header_propagation'], maxAgeMs: 1 },
    });
    early();
    expect(window.fetch).toBe(before);
  });

  it('decorates before the tracker mounts; the first page view takes the pending id', async () => {
    early();
    await window.fetch('/api/boot');
    const bootHeaders = lastAppHeaders();
    const session = bootHeaders.get(INGEST_HEADERS.session)!;
    const pendingView = bootHeaders.get(INGEST_HEADERS.pageView)!;
    expect(session).toBeTruthy();
    expect(pendingView).toBe(globalState().pendingPageViewId);

    mount();
    await h.flushByTimer();
    const [batch] = h.batches();
    expect(batch!.sessionId).toBe(session);
    expect(batch!.events[0]).toMatchObject({ type: 'page_view', eventId: pendingView });
    await window.fetch('/api/after');
    expect(lastAppHeaders().get(INGEST_HEADERS.pageView)).toBe(pendingView);
  });

  it('a stored signed-in session is KEPT by the first page view while the user is not known yet', async () => {
    const stored = sharedSessionStore().nextEvent('a@libas.in', Date.now());
    early();
    await window.fetch('/api/boot');
    const bootHeaders = lastAppHeaders();
    expect(bootHeaders.get(INGEST_HEADERS.session)).toBe(stored.sessionId);
    const pendingView = bootHeaders.get(INGEST_HEADERS.pageView);

    mount(); // auth not resolved yet: no user
    await h.flushByTimer();
    const [batch] = h.batches();
    expect(batch!.sessionId).toBe(stored.sessionId);
    expect(batch!.events[0]).toMatchObject({ type: 'page_view', eventId: pendingView });
  });

  it('the early allow-list keeps working after a tracker mounts WITHOUT propagateHeadersTo', async () => {
    early({ propagateHeadersTo: ['https://api.example.com'] });
    mount();
    await h.settle();
    await window.fetch('https://api.example.com/v1/items');
    expect(lastAppHeaders().has(INGEST_HEADERS.session)).toBe(true);
    await window.fetch('https://other.example.com/v1/items');
    expect(lastAppHeaders().has(INGEST_HEADERS.session)).toBe(false);
  });

  it('a decorated Request keeps its own referrer policy', async () => {
    early();
    await window.fetch(new Request(`${window.location.origin}/api/report`, { referrerPolicy: 'no-referrer' }));
    const [input, init] = appFetch.mock.calls.at(-1)!;
    expect(input).toBeInstanceOf(Request);
    expect((init as RequestInit).referrerPolicy).toBe('no-referrer');
    expect(new Headers((init as RequestInit).headers).has(INGEST_HEADERS.session)).toBe(true);
  });

  it('early and tracker share ONE session id with storage blocked', async () => {
    const throwing = { configurable: true, get: () => { throw new Error('SecurityError'); } };
    const session = Object.getOwnPropertyDescriptor(window, 'sessionStorage')!;
    const local = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'sessionStorage', throwing);
    Object.defineProperty(window, 'localStorage', throwing);
    try {
      early();
      await window.fetch('/api/boot');
      const sid = lastAppHeaders().get(INGEST_HEADERS.session);
      mount();
      await h.flushByTimer();
      expect(h.batches()[0]!.sessionId).toBe(sid);
    } finally {
      Object.defineProperty(window, 'sessionStorage', session);
      Object.defineProperty(window, 'localStorage', local);
    }
  });

  it('never decorates the ingest or config request, and a later host wrapper never sees them', async () => {
    early();
    mount();
    // The host wraps fetch AFTER us to add Authorization (an API-client interceptor).
    const ours = window.fetch;
    const hostWrapper = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      headers.set('Authorization', 'Bearer secret');
      return ours(input, { ...init, headers });
    });
    window.fetch = hostWrapper as unknown as typeof fetch;
    await vi.advanceTimersByTimeAsync(6 * 60_000); // flushes + one config refresh
    const sdkCalls = h.fetch.mock.calls.filter((c) => String(c[0]).startsWith(TEST_URL));
    expect(sdkCalls.some((c) => String(c[0]).endsWith('/ingest/browser'))).toBe(true);
    expect(sdkCalls.some((c) => String(c[0]).endsWith('/ingest/config'))).toBe(true);
    for (const [, init] of sdkCalls) {
      const headers = new Headers((init as RequestInit | undefined)?.headers);
      expect(headers.has('Authorization')).toBe(false);
      expect(headers.has(INGEST_HEADERS.session)).toBe(false);
    }
    expect(hostWrapper.mock.calls.filter((c) => String(c[0]).startsWith(TEST_URL))).toEqual([]);
  });

  it('kill: a 403 BROWSER_INGEST_DISABLED from config → next fetch AND XHR undecorated, fetch restored, queue purged', async () => {
    const originalOpen = FakeXhr.prototype.open;
    const queueKey = `nexus.retry:${TEST_SCOPE}`;
    h.respondToConfig(() => jsonResponse(403, { error: { code: 'BROWSER_INGEST_DISABLED' } }));
    h.respondToIngest(() => jsonResponse(503, {}));
    early();
    expect(window.fetch).not.toBe(appFetch);
    const queued = { envelope: { key: TEST_KEY, sessionId: 's', sentAt: 'x', events: [{ eventId: 'e', occurredAt: new Date().toISOString() }] }, attempts: 3, replays: 0 };
    window.localStorage.setItem(queueKey, JSON.stringify([queued]));

    mount();
    await h.settle();

    expect(window.fetch).toBe(appFetch);
    expect(FakeXhr.prototype.open).toBe(originalOpen);
    expect(window.localStorage.getItem(queueKey)).toBeNull();
    await window.fetch('/api/after-kill');
    expect(lastAppHeaders().has(INGEST_HEADERS.session)).toBe(false);
    const x = new XMLHttpRequest() as unknown as FakeXhr;
    x.open();
    x.send();
    expect(x.headers).toEqual([]);
  });

  it('kill while someone wrapped fetch after us: our wrapper stays but passes through', async () => {
    h.respondToConfig(() => jsonResponse(403, { error: { code: 'APP_DISABLED' } }));
    early();
    const ours = window.fetch;
    const hostWrapper = ((input: RequestInfo | URL, init?: RequestInit) => ours(input, init)) as typeof fetch;
    window.fetch = hostWrapper;
    mount();
    await h.settle();
    expect(window.fetch).toBe(hostWrapper);
    await window.fetch('/api/x');
    expect(lastAppHeaders().has(INGEST_HEADERS.session)).toBe(false);
  });
});

describe('the early bundle', () => {
  it('imports no react, tracker, registry or remote-config code — transitively', () => {
    // Walk the whole relative import graph of early.ts: a forbidden module reached through a
    // helper would land in the bundle just the same.
    const srcDir = dirname(fileURLToPath(import.meta.url));
    const seen = new Set<string>();
    const bare = new Set<string>();
    const visit = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(join(srcDir, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '') // doc comments quote imports (`import './nexus-early';`)
        .replace(/^\s*\/\/.*$/gm, '');
      for (const [, spec] of source.matchAll(/(?:from|import)\s+'([^']+)'/g)) {
        if (!spec!.startsWith('.')) {
          bare.add(spec!);
          continue;
        }
        visit(join(dirname(file), `${spec}.ts`).replace(/\\/g, '/'));
      }
    };
    visit('early.ts');
    const forbidden = [...seen].filter((f) =>
      /browser-tracker|registry|remote-config|kill|transport|batch-sender|retry-|use-nexus-tracker|next/.test(f),
    );
    expect(forbidden).toEqual([]);
    expect([...bare].filter((spec) => !spec.startsWith('@nexus/shared/'))).toEqual([]);
    expect(seen.has('core/config-cache.ts')).toBe(true); // sanity: the walk follows imports
  });
});
