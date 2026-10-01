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
  it('sends load first, then route with the previous in-app path and a final page_time', () => {
    Object.defineProperty(document, 'referrer', {
      configurable: true,
      value: 'https://mail.google.com/mail/u/0?secret=1',
    });
    const view = mount();
    vi.advanceTimersByTime(1500);
    view.rerender({ url: TEST_URL, publishableKey: TEST_KEY, pathname: '/my-app/b?q=private' });
    view.rerender({ url: TEST_URL, publishableKey: TEST_KEY, pathname: '/my-app/b' }); // same path
    h.flushByTimer();

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

  it('does not double-count under React StrictMode', () => {
    function App() {
      useNexusTracker({ url: TEST_URL, publishableKey: TEST_KEY, pathname: '/my-app/a' });
      return null;
    }
    render(createElement(StrictMode, null, createElement(App)));
    vi.advanceTimersByTime(1);
    h.flushByTimer();
    expect(ofType(h.events(), 'page_view')).toHaveLength(1);
    expect(ofType(h.events(), 'page_time').filter((e) => e.final)).toHaveLength(0);
  });
});

describe('page time', () => {
  it('sends visible-time DELTAS on hidden, idle interval and route change', () => {
    const view = mount();
    vi.advanceTimersByTime(3000);
    h.setVisibility('hidden'); // t=3000 → hidden delta 3000 (flushed immediately)
    expect(h.beacon).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000); // hidden: not counted
    h.setVisibility('visible'); // t=13000
    vi.advanceTimersByTime(2000); // t=15000 → interval while visible: idle delta 2000
    vi.advanceTimersByTime(500);
    view.rerender({ url: TEST_URL, publishableKey: TEST_KEY, pathname: '/my-app/b' });
    h.flushByTimer();

    const viewId = ofType(h.events(), 'page_view')[0]!.eventId;
    const times = ofType(h.events(), 'page_time').filter((t) => t.pageViewId === viewId);
    expect(times.map((t) => [t.reason, t.visibleMs, t.final])).toEqual([
      ['hidden', 3000, false],
      ['idle', 2000, false],
      ['route', 500, true],
    ]);
  });

  it('sends a final pagehide delta immediately', () => {
    mount();
    vi.advanceTimersByTime(1200);
    window.dispatchEvent(new Event('pagehide'));
    const time = ofType(h.events(), 'page_time')[0]!;
    expect(time).toMatchObject({ reason: 'pagehide', final: true, visibleMs: 1200 });
  });
});

describe('tool use', () => {
  it('captures clicks on [data-nexus-tool] from data attributes only', () => {
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
    h.flushByTimer();

    const tools = ofType(h.events(), 'tool_use');
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ tool: 'audits.export-csv', action: 'export', label: 'Export CSV', path: '/my-app/a' });
    expect(JSON.stringify(tools[0])).not.toContain('Customer typed text');
  });

  it('does not listen when autoTools is false, but trackTool/trackEvent still work', () => {
    mount({ autoTools: false });
    document.body.innerHTML = '<button id="t" data-nexus-tool="a.b">x</button>';
    document.getElementById('t')!.click();
    trackTool('reports.run', { action: 'submit', value: 3, props: { rows: 10, Bad: 1 } });
    trackTool('Invalid Tool');
    trackEvent('report.generated', { value: 2 });
    h.flushByTimer();

    const events = h.events();
    expect(ofType(events, 'tool_use')).toEqual([
      expect.objectContaining({ tool: 'reports.run', action: 'submit', value: 3, props: { rows: 10 } }),
    ]);
    expect(ofType(events, 'custom')).toEqual([expect.objectContaining({ name: 'report.generated', value: 2 })]);
  });
});

describe('sessions', () => {
  it('rotates the session after the idle timeout and resets seq', () => {
    mount();
    h.setVisibility('hidden');
    vi.advanceTimersByTime(31 * 60 * 1000);
    h.setVisibility('visible');
    trackTool('a.b');
    h.flushByTimer();

    const batches = h.batches();
    const first = batches[0]!.sessionId;
    const last = batches.at(-1)!;
    expect(last.sessionId).not.toBe(first);
    expect(last.events[0]).toMatchObject({ type: 'tool_use', seq: 0 });
  });

  it('rotates on user change, keeps the session on first sign-in', () => {
    const view = mount();
    view.rerender({ url: TEST_URL, publishableKey: TEST_KEY, pathname: '/my-app/a', user: { email: 'A@libas.in' } });
    trackTool('a.b');
    view.rerender({ url: TEST_URL, publishableKey: TEST_KEY, pathname: '/my-app/a', user: { email: 'b@libas.in' } });
    trackTool('a.c');
    h.flushByTimer();

    const batches = h.batches();
    expect(batches[0]!.user).toBeUndefined();
    expect(batches[1]!.sessionId).toBe(batches[0]!.sessionId); // anonymous → signed in
    expect(batches[1]!.user).toEqual({ email: 'a@libas.in' });
    expect(batches[2]!.sessionId).not.toBe(batches[1]!.sessionId); // user changed
    expect(batches[2]!.user).toEqual({ email: 'b@libas.in' });
    expect(batches[2]!.events[0]!.seq).toBe(0);
  });

  it('keeps working silently when storage throws', () => {
    const throwing = { configurable: true, get: () => { throw new Error('SecurityError'); } };
    const session = Object.getOwnPropertyDescriptor(window, 'sessionStorage')!;
    const local = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'sessionStorage', throwing);
    Object.defineProperty(window, 'localStorage', throwing);
    try {
      expect(() => mount()).not.toThrow();
      trackTool('a.b');
      h.flushByTimer();
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
  it('sends a contract-valid text/plain beacon with the key in the body', () => {
    mount({ user: { email: 'a@libas.in' } });
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
      client: { sdk: '@nexus/react', version: '1.0.0' },
    });
    expect(parsed.data!.events.map((e) => e.type)).toEqual(['page_view', 'tool_use', 'custom', 'page_time']);
  });

  it('falls back to keepalive fetch when the beacon is refused', () => {
    h.beacon.mockReturnValue(false);
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })));
    vi.stubGlobal('fetch', fetchMock);
    mount();
    h.flushByTimer();
    expect(fetchMock).toHaveBeenCalledWith(
      TEST_INGEST_URL,
      expect.objectContaining({
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      }),
    );
  });

  it('never throws when every transport is broken', () => {
    h.beacon.mockImplementation(() => {
      throw new Error('boom');
    });
    vi.stubGlobal('fetch', () => {
      throw new Error('boom');
    });
    mount();
    expect(() => h.flushByTimer()).not.toThrow();
  });
});

describe('propagateHeaders', () => {
  it('adds session/page-view headers to SAME-ORIGIN fetches only, and restores fetch', async () => {
    const original = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response('{}')),
    );
    window.fetch = original as unknown as typeof fetch;
    const sameOriginIngest = `${window.location.origin}/traffic`;
    const view = mount({ url: sameOriginIngest, propagateHeaders: true });
    expect(window.fetch).not.toBe(original);

    await window.fetch('/my-app/api/stores', { headers: { Accept: 'application/json' } });
    await window.fetch('https://other.example.com/api');
    await window.fetch(`${sameOriginIngest}/api/v1/ingest/browser`, { method: 'POST' });

    const sameHeaders = new Headers(original.mock.calls[0]![1]!.headers);
    expect(isUuid(sameHeaders.get('X-Nexus-Session'))).toBe(true);
    expect(isUuid(sameHeaders.get('X-Nexus-Page-View'))).toBe(true);
    expect(sameHeaders.get('Accept')).toBe('application/json');
    expect(original.mock.calls[1]![1]).toBeUndefined();
    expect(new Headers(original.mock.calls[2]![1]!.headers).has('X-Nexus-Session')).toBe(false);

    view.unmount();
    vi.advanceTimersByTime(1);
    expect(window.fetch).toBe(original);
  });

  it('does not patch fetch by default', () => {
    const original = window.fetch;
    mount();
    expect(window.fetch).toBe(original);
  });
});

describe('no-op cases', () => {
  it.each([
    ['disabled', { disabled: true }],
    ['missing url', { url: undefined }],
    ['missing key', { publishableKey: '' }],
  ] as const)('%s → no events, no listeners', (_name, override) => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    mount(override as Partial<UseNexusTrackerOptions>);
    trackTool('a.b');
    document.body.innerHTML = '<button id="t" data-nexus-tool="a.b">x</button>';
    document.getElementById('t')!.click();
    vi.advanceTimersByTime(60_000);
    expect(h.beacon).not.toHaveBeenCalled();
    expect(addSpy).not.toHaveBeenCalledWith('click', expect.anything(), true);
  });
});
