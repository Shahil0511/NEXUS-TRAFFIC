import { browserIngestBatchSchema } from '@nexus/shared/ingest';
import { act, render, renderHook } from '@testing-library/react';
import { StrictMode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isUuid } from './core/uuid';
import type { BrowserWireEvent, PageTimeWireEvent, PageViewWireEvent } from './core/wire';
import {
  TEST_INGEST_URL,
  TEST_KEY,
  TEST_URL,
  setupHarness,
  type Harness,
} from './test-harness';
import { trackEvent, trackTool, useNexusTracker, type UseNexusTrackerOptions } from './use-nexus-tracker';

let h: Harness;

beforeEach(() => {
  h = setupHarness();
});

afterEach(() => {
  h.teardown();
});

function mount(initial: Partial<UseNexusTrackerOptions> = {}) {
  const base: UseNexusTrackerOptions = {
    url: TEST_URL,
    publishableKey: TEST_KEY,
    pathname: '/my-app/a',
    ...initial,
  };
  return renderHook((props: UseNexusTrackerOptions) => useNexusTracker(props), {
    initialProps: base,
  });
}

function ofType<T extends BrowserWireEvent['type']>(events: BrowserWireEvent[], type: T) {
  return events.filter((e) => e.type === type) as Extract<BrowserWireEvent, { type: T }>[];
}

describe('page views', () => {
  it('sends load first, then route with the previous in-app path and a final page_time', async () => {
    Object.defineProperty(document, 'referrer', {
      configurable: true,
      value: 'https://mail.google.com/mail/u/0?secret=1',
    });
    const view = mount();
    vi.advanceTimersByTime(1500);
    view.rerender({ url: TEST_URL, publishableKey: TEST_KEY, pathname: '/my-app/b?q=private' });
    view.rerender({ url: TEST_URL, publishableKey: TEST_KEY, pathname: '/my-app/b' }); // same path
    await h.flushByTimer();

    const events = h.events();
    const [first, time, second] = events as [PageViewWireEvent, PageTimeWireEvent, PageViewWireEvent];
    expect(first).toMatchObject({ type: 'page_view', nav: 'load', path: '/my-app/a', seq: 0, referrerHost: 'mail.google.com' });
    expect(first.referrerPath).toBeUndefined();
    expect(time).toMatchObject({
      type: 'page_time',
      pageViewId: first.eventId,
      visibleMs: 1500,
      final: true,
      reason: 'route',
      path: '/my-app/a',
      seq: 1,
    });
    expect(second).toMatchObject({ type: 'page_view', nav: 'route', path: '/my-app/b', referrerPath: '/my-app/a', seq: 2 });
    expect(second.referrerHost).toBeUndefined();
    expect(ofType(events, 'page_view')).toHaveLength(2);
  });

  it('does not double-count under React StrictMode', async () => {
    function App() {
      useNexusTracker({ url: TEST_URL, publishableKey: TEST_KEY, pathname: '/my-app/a' });
      return null;
    }
    render(createElement(StrictMode, null, createElement(App)));
    vi.advanceTimersByTime(1);
    await h.flushByTimer();
    expect(ofType(h.events(), 'page_view')).toHaveLength(1);
    expect(ofType(h.events(), 'page_time').filter((e) => e.final)).toHaveLength(0);
  });
});

describe('page time', () => {
  it('sends visible-time DELTAS on hidden, idle interval and route change', async () => {
    const view = mount();
    vi.advanceTimersByTime(3000);
    h.setVisibility('hidden'); // t=3000 → hidden delta 3000 (flushed immediately)
    expect(h.beacon).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000); // hidden: not counted
    h.setVisibility('visible'); // t=13000
    vi.advanceTimersByTime(2000); // t=15000 → interval while visible: idle delta 2000
    vi.advanceTimersByTime(500);
    view.rerender({ url: TEST_URL, publishableKey: TEST_KEY, pathname: '/my-app/b' });
    await h.flushByTimer();

    const viewId = ofType(h.events(), 'page_view')[0]!.eventId;
    const times = ofType(h.events(), 'page_time').filter((t) => t.pageViewId === viewId);
    expect(times.map((t) => [t.reason, t.visibleMs, t.final])).toEqual([
      ['hidden', 3000, false],
      ['idle', 2000, false],
      ['route', 500, true],
    ]);
  });

  it('sends a final pagehide delta immediately', async () => {
    mount();
    vi.advanceTimersByTime(1200);
    window.dispatchEvent(new Event('pagehide'));
    const time = ofType(h.events(), 'page_time')[0]!;
    expect(time).toMatchObject({ reason: 'pagehide', final: true, visibleMs: 1200 });
  });
});

describe('tool use', () => {
  it('captures clicks on [data-nexus-tool] from data attributes only', async () => {
    mount();
    document.body.innerHTML = `
      <button data-nexus-tool="audits.export-csv" data-nexus-action="export" data-nexus-label="Export CSV">
        <span id="inner">Customer typed text</span>
      </button>
      <button id="bad" data-nexus-tool="Bad Name">x</button>
      <button id="plain">x</button>`;
    document.getElementById('inner')!.click();
    document.getElementById('bad')!.click();
    document.getElementById('plain')!.click();
    await h.flushByTimer();

    const tools = ofType(h.events(), 'tool_use');
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ tool: 'audits.export-csv', action: 'export', label: 'Export CSV', path: '/my-app/a' });
    expect(JSON.stringify(tools[0])).not.toContain('Customer typed text');
  });

  it('does not listen when autoTools is false, but trackTool/trackEvent still work', async () => {
    mount({ autoTools: false });
    document.body.innerHTML = '<button id="t" data-nexus-tool="a.b">x</button>';
    document.getElementById('t')!.click();
    trackTool('reports.run', { action: 'submit', value: 3, props: { rows: 10, Bad: 1 } });
    trackTool('Invalid Tool');
    trackEvent('report.generated', { value: 2 });
    await h.flushByTimer();

    const events = h.events();
    expect(ofType(events, 'tool_use')).toEqual([
      expect.objectContaining({ tool: 'reports.run', action: 'submit', value: 3, props: { rows: 10 } }),
    ]);
    expect(ofType(events, 'custom')).toEqual([expect.objectContaining({ name: 'report.generated', value: 2 })]);
  });
});

describe('sessions', () => {
  it('rotates the session after the idle timeout and resets seq', async () => {
    mount();
    h.setVisibility('hidden');
    vi.advanceTimersByTime(31 * 60 * 1000);
    h.setVisibility('visible');
    trackTool('a.b');
    await h.flushByTimer();

    const batches = h.batches();
    const first = batches[0]!.sessionId;
    const last = batches.at(-1)!;
    expect(last.sessionId).not.toBe(first);
    expect(last.events[0]).toMatchObject({ type: 'tool_use', seq: 0 });
  });

  it('rotates on user change, keeps the session on first sign-in', async () => {
    const view = mount();
    view.rerender({ url: TEST_URL, publishableKey: TEST_KEY, pathname: '/my-app/a', user: { email: 'A@libas.in' } });
    trackTool('a.b');
    view.rerender({ url: TEST_URL, publishableKey: TEST_KEY, pathname: '/my-app/a', user: { email: 'b@libas.in' } });
    trackTool('a.c');
    await h.flushByTimer();

    const batches = h.batches();
    expect(batches[0]!.user).toBeUndefined();
    expect(batches[1]!.sessionId).toBe(batches[0]!.sessionId); // anonymous → signed in
    expect(batches[1]!.user).toEqual({ email: 'a@libas.in' });
    expect(batches[2]!.sessionId).not.toBe(batches[1]!.sessionId); // user changed
    expect(batches[2]!.user).toEqual({ email: 'b@libas.in' });
    expect(batches[2]!.events[0]!.seq).toBe(0);
  });

  it('keeps working silently when storage throws', async () => {
    const throwing = { configurable: true, get: () => { throw new Error('SecurityError'); } };
    const session = Object.getOwnPropertyDescriptor(window, 'sessionStorage')!;
    const local = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'sessionStorage', throwing);
    Object.defineProperty(window, 'localStorage', throwing);
    try {
      expect(() => mount()).not.toThrow();
      trackTool('a.b');
      await h.flushByTimer();
      const [batch] = h.batches();
      expect(isUuid(batch!.sessionId)).toBe(true);
      expect(isUuid(batch!.anonymousId)).toBe(true);
      // page_view, tool_use, idle page_time — one session (memory fallback), seq keeps counting
      expect(batch!.events.map((e) => e.seq)).toEqual([0, 1, 2]);
    } finally {
      Object.defineProperty(window, 'sessionStorage', session);
      Object.defineProperty(window, 'localStorage', local);
    }
  });
});

describe('transport and payload', () => {
  it('sends a contract-valid text/plain beacon with the key in the body on pagehide', async () => {
    mount({ user: { email: 'a@libas.in' }, release: '2026.11.18-a1b2c3d', environment: 'staging' });
    vi.advanceTimersByTime(800);
    trackTool('audits.export-csv', { action: 'export', label: 'Export CSV', value: 12, props: { format: 'csv' } });
    trackEvent('report.generated', { value: 1 });
    act(() => undefined);
    window.dispatchEvent(new Event('pagehide'));

    const [url, blob] = h.beacon.mock.calls[0] as [string, { type: string }];
    expect(url).toBe(TEST_INGEST_URL);
    expect(blob.type).toBe('text/plain;charset=UTF-8');

    const parsed = browserIngestBatchSchema.safeParse(JSON.parse(h.rawBodies()[0]!));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data).toMatchObject({
      key: TEST_KEY,
      user: { email: 'a@libas.in' },
      environment: 'staging',
      release: '2026.11.18-a1b2c3d',
      client: { sdk: '@nexus/react', version: '1.1.0' },
    });
    expect(parsed.data!.client!.replay).toBeUndefined();
    expect(parsed.data!.events.map((e) => e.type)).toEqual(['page_view', 'tool_use', 'custom', 'page_time']);
  });

  it('live batches go through the captured fetch with keepalive and the SSO cookie', async () => {
    mount();
    await h.flushByTimer();
    expect(h.sent().map((s) => s.via)).toEqual(['fetch']);
    expect(h.fetch).toHaveBeenCalledWith(
      TEST_INGEST_URL,
      expect.objectContaining({
        method: 'POST',
        keepalive: true,
        credentials: 'include',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      }),
    );
  });

  it('falls back to keepalive fetch when the unload beacon is refused', async () => {
    h.beacon.mockReturnValue(false);
    mount();
    window.dispatchEvent(new Event('pagehide'));
    await h.settle();
    const ingestCalls = h.fetch.mock.calls.filter((c) => c[0] === TEST_INGEST_URL);
    expect(ingestCalls).toHaveLength(1);
    expect(ingestCalls[0]![1]).toMatchObject({ keepalive: true, method: 'POST' });
  });

  it('environment defaults to dev on a loopback page; an invalid release is dropped', async () => {
    mount({ release: 'x'.repeat(65) });
    await h.flushByTimer();
    const [batch] = h.batches();
    expect(window.location.hostname).toBe('localhost');
    expect(batch!.environment).toBe('dev');
    expect(batch!.release).toBeUndefined();
  });

  it('never throws when every transport is broken', async () => {
    h.beacon.mockImplementation(() => {
      throw new Error('boom');
    });
    vi.stubGlobal('fetch', () => {
      throw new Error('boom');
    });
    mount();
    await expect(h.flushByTimer()).resolves.toBeUndefined();
    window.dispatchEvent(new Event('pagehide'));
    await expect(h.settle()).resolves.toBeUndefined();
  });
});

describe('route templates', () => {
  it('stamps the template on all four event types of the view', async () => {
    const view = mount({ pathname: '/my-app/stores/12', routeTemplate: '/my-app/stores/:id' });
    vi.advanceTimersByTime(1000);
    trackTool('stores.open');
    trackEvent('store.viewed');
    view.rerender({ url: TEST_URL, publishableKey: TEST_KEY, pathname: '/my-app/audits' });
    await h.flushByTimer();

    const events = h.events();
    const storeEvents = events.filter((e) => e.path === '/my-app/stores/12');
    expect(storeEvents.map((e) => e.type).sort()).toEqual(['custom', 'page_time', 'page_view', 'tool_use']);
    for (const event of storeEvents) expect(event.routeTemplate).toBe('/my-app/stores/:id');
    expect(events.find((e) => e.path === '/my-app/audits')!.routeTemplate).toBeUndefined();
    for (const batch of h.batches()) expect(browserIngestBatchSchema.safeParse(batch).success).toBe(true);
  });

  it('drops a template longer than the contract limit', async () => {
    mount({ routeTemplate: `/${'a'.repeat(300)}` });
    await h.flushByTimer();
    expect(h.events()[0]!.routeTemplate).toBeUndefined();
  });
});

describe('propagateHeaders', () => {
  it('is ON by default: same-origin fetches get the headers, other origins and ingest do not', async () => {
    const original = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response('{}')),
    );
    window.fetch = original as unknown as typeof fetch;
    const sameOriginNexus = `${window.location.origin}/traffic`;
    const view = mount({ url: sameOriginNexus });
    expect(window.fetch).not.toBe(original);

    await window.fetch('/my-app/api/stores', { headers: { Accept: 'application/json' } });
    await window.fetch('https://other.example.com/api');
    await window.fetch(`${sameOriginNexus}/api/v1/ingest/browser`, { method: 'POST' });
    await window.fetch(`${sameOriginNexus}/api/v1/ingest/config`, { method: 'POST' });

    const call = (url: string) => original.mock.calls.filter((c) => String(c[0]) === url).at(-1)!;
    const sameHeaders = new Headers(call('/my-app/api/stores')[1]!.headers);
    expect(isUuid(sameHeaders.get('X-Nexus-Session'))).toBe(true);
    expect(isUuid(sameHeaders.get('X-Nexus-Page-View'))).toBe(true);
    expect(sameHeaders.get('Accept')).toBe('application/json');
    expect(call('https://other.example.com/api')[1]).toBeUndefined();
    for (const path of ['browser', 'config']) {
      const init = call(`${sameOriginNexus}/api/v1/ingest/${path}`)[1];
      expect(new Headers(init?.headers).has('X-Nexus-Session')).toBe(false);
    }

    view.unmount();
    vi.advanceTimersByTime(1);
    expect(window.fetch).toBe(original);
  });

  it('decorates a cross origin only when propagateHeadersTo lists it', async () => {
    const original = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response('{}')),
    );
    window.fetch = original as unknown as typeof fetch;
    mount({ propagateHeadersTo: ['https://API.example.com/'] });
    await window.fetch('https://api.example.com/v1/x');
    await window.fetch('https://evil.example.com/v1/x');
    const byUrl = (url: string) => original.mock.calls.find((c) => String(c[0]) === url)!;
    expect(new Headers(byUrl('https://api.example.com/v1/x')[1]!.headers).has('X-Nexus-Session')).toBe(true);
    expect(byUrl('https://evil.example.com/v1/x')[1]).toBeUndefined();
  });

  it('an untyped (JS) caller passing a STRING never crashes the render', async () => {
    const asString = 'https://api.example.com' as unknown as readonly string[];
    expect(() => mount({ propagateHeadersTo: asString })).not.toThrow();
    await h.flushByTimer();
    expect(h.events()[0]).toMatchObject({ type: 'page_view' });
  });

  it('does not patch fetch when propagateHeaders is false', () => {
    const original = window.fetch;
    mount({ propagateHeaders: false });
    expect(window.fetch).toBe(original);
  });
});

describe('no-op cases', () => {
  it.each([
    ['disabled', { disabled: true }],
    ['missing url', { url: undefined }],
    ['missing key', { publishableKey: '' }],
  ] as const)('%s → no events, no listeners, no requests', async (_name, override) => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const original = window.fetch;
    mount(override as Partial<UseNexusTrackerOptions>);
    trackTool('a.b');
    document.body.innerHTML = '<button id="t" data-nexus-tool="a.b">x</button>';
    document.getElementById('t')!.click();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sent()).toEqual([]);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(window.fetch).toBe(original);
    expect(addSpy).not.toHaveBeenCalledWith('click', expect.anything(), true);
  });
});
