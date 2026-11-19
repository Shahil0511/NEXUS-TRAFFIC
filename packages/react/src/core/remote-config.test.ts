import { SDK_KILL_ERROR_CODES } from '@nexus/shared/errors';
import {
  SDK_CONFIG_RESPONSE_EXAMPLE,
  sdkConfigRequestSchema,
  sdkRemoteConfigSchema,
  type SdkConfigRequest,
  type SdkRemoteConfig,
} from '@nexus/shared/ingest';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_REMOTE_CONFIG,
  jsonResponse,
  setupHarness,
  TEST_KEY,
  TEST_SCOPE,
  TEST_URL,
  type Harness,
} from '../test-harness';
import { useNexusTracker, type UseNexusTrackerOptions } from '../use-nexus-tracker';
import { readCachedConfig, writeCachedConfig } from './config-cache';
import { globalState } from './global-state';
import { parseRemoteConfig } from './remote-config';
import { getNexusStats } from './stats';
import { classifyDelivery } from './transport';
import type { SdkConfigWireRequest, SdkRemoteConfigWire } from './wire';

// Compile-time: the hand-written wire mirrors equal the zod-inferred contract types.
const _configMatches: SdkRemoteConfigWire extends SdkRemoteConfig ? true : never = true;
const _configCovers: SdkRemoteConfig extends SdkRemoteConfigWire ? true : never = true;
const _requestMatches: SdkConfigWireRequest extends SdkConfigRequest ? true : never = true;
const _requestCovers: SdkConfigRequest extends SdkConfigWireRequest ? true : never = true;
void [_configMatches, _configCovers, _requestMatches, _requestCovers];

let h: Harness;
beforeEach(() => {
  h = setupHarness();
});
afterEach(() => {
  h.teardown();
});

const options: UseNexusTrackerOptions = { url: TEST_URL, publishableKey: TEST_KEY, pathname: '/my-app/a' };
const mount = (extra: Partial<UseNexusTrackerOptions> = {}) =>
  renderHook((p: UseNexusTrackerOptions) => useNexusTracker(p), { initialProps: { ...options, ...extra } });

describe('parseRemoteConfig', () => {
  it('accepts exactly what sdkRemoteConfigSchema accepts', () => {
    expect(parseRemoteConfig(SDK_CONFIG_RESPONSE_EXAMPLE)).toEqual(SDK_CONFIG_RESPONSE_EXAMPLE);
    expect(sdkRemoteConfigSchema.safeParse(parseRemoteConfig(DEFAULT_REMOTE_CONFIG)).success).toBe(true);
    for (const bad of [null, [], { ...SDK_CONFIG_RESPONSE_EXAMPLE, contract: 2 }, { ...SDK_CONFIG_RESPONSE_EXAMPLE, version: 0 }, { ...SDK_CONFIG_RESPONSE_EXAMPLE, maxAgeMs: -1 }, { ...SDK_CONFIG_RESPONSE_EXAMPLE, disabledModules: 'x' }]) {
      expect(parseRemoteConfig(bad)).toBeNull();
      expect(sdkRemoteConfigSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('classifyDelivery', () => {
  it.each([
    [202, undefined, 'delivered'],
    [400, 'INVALID_ENVELOPE', 'drop'],
    [413, undefined, 'drop'],
    [415, undefined, 'drop'],
    [403, 'ORIGIN_NOT_ALLOWED', 'drop'],
    [429, undefined, 'retry'],
    [503, undefined, 'retry'],
    ...SDK_KILL_ERROR_CODES.map((code) => [403, code, 'disabled'] as const),
    [401, 'INVALID_API_KEY', 'disabled'],
  ] as const)('%s %s → %s', (status, code, outcome) => {
    expect(classifyDelivery(status, code)).toBe(outcome);
  });
});

describe('remote config in the tracker', () => {
  it('posts {key, client} as text/plain with credentials omitted, via the native fetch', async () => {
    mount();
    await h.settle();
    const [body] = h.configRequests();
    expect(sdkConfigRequestSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({ key: TEST_KEY, client: { sdk: '@nexus/react', version: '1.1.0' } });
    const call = h.fetch.mock.calls.find((c) => String(c[0]).endsWith('/ingest/config'))!;
    expect(call[1]).toMatchObject({ method: 'POST', credentials: 'omit' });
    expect(getNexusStats().configVersion).toBe(1);
  });

  it('a module switch applies (auto_tools off → clicks ignored, trackTool still works)', async () => {
    h.respondToConfig(() => jsonResponse(200, { ...DEFAULT_REMOTE_CONFIG, version: 2, disabledModules: ['auto_tools'] }));
    mount();
    await h.settle();
    document.body.innerHTML = '<button id="t" data-nexus-tool="a.b">x</button>';
    document.getElementById('t')!.click();
    globalState().active!.trackTool('c.d');
    await h.flushByTimer();
    const tools = h.events().filter((e) => e.type === 'tool_use');
    expect(tools.map((t) => (t as { tool: string }).tool)).toEqual(['c.d']);
  });

  it('a cached disable is honoured synchronously: nothing is patched or sent', async () => {
    writeCachedConfig(TEST_SCOPE, { at: Date.now(), enabled: false, config: null });
    const original = window.fetch;
    mount();
    expect(window.fetch).toBe(original);
    await h.flushByTimer();
    expect(h.sent()).toEqual([]);
    expect(h.configRequests()).toEqual([]); // recheck only after disabledRecheckMs
    expect(getNexusStats().disabled).toBe(true);
  });

  it('a network failure keeps the cached config', async () => {
    const cached = { ...DEFAULT_REMOTE_CONFIG, version: 4, disabledModules: ['custom'] } as SdkRemoteConfigWire;
    writeCachedConfig(TEST_SCOPE, { at: Date.now() - 10 * 60_000, enabled: true, config: cached });
    h.respondToConfig(() => {
      throw new TypeError('Failed to fetch');
    });
    mount();
    await h.settle();
    expect(h.configRequests()).toHaveLength(1);
    expect(readCachedConfig(TEST_SCOPE)?.config?.version).toBe(4);
    expect(globalState().remote.get(TEST_SCOPE)?.disabledModules).toEqual(['custom']);
  });

  it('a version regression is ignored', async () => {
    const cached = { ...DEFAULT_REMOTE_CONFIG, version: 5, disabledModules: ['custom'] } as SdkRemoteConfigWire;
    writeCachedConfig(TEST_SCOPE, { at: Date.now() - 10 * 60_000, enabled: true, config: cached });
    h.respondToConfig(() => jsonResponse(200, { ...DEFAULT_REMOTE_CONFIG, version: 3 }));
    mount();
    await h.settle();
    expect(globalState().remote.get(TEST_SCOPE)?.version).toBe(5);
    expect(readCachedConfig(TEST_SCOPE)?.config?.version).toBe(5);
  });

  it('5xx and an invalid body change nothing', async () => {
    h.respondToConfig(() => jsonResponse(500, {}));
    mount();
    await h.settle();
    expect(readCachedConfig(TEST_SCOPE)).toBeNull();
    expect(getNexusStats().disabled).toBe(false);
  });

  it.each([
    ['a 5xx', () => jsonResponse(503, {})],
    ['a 429', () => jsonResponse(429, {})],
    ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
  ] as const)('%s is not re-asked on every flush tick (once per maxAgeMs per page)', async (_label, responder) => {
    h.respondToConfig(responder);
    mount();
    await h.settle();
    expect(h.configRequests()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(4 * 60_000); // 48 flush ticks
    expect(h.configRequests()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2 * 60_000); // past configMaxAgeMs (5 min)
    expect(h.configRequests()).toHaveLength(2);
  });

  it('blocked localStorage does not turn every flush tick into a config request', async () => {
    const local = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('SecurityError');
      },
    });
    try {
      mount();
      await h.settle();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.configRequests()).toHaveLength(1);
    } finally {
      Object.defineProperty(window, 'localStorage', local);
    }
  });

  it('remote config cannot enable propagation', async () => {
    const original = window.fetch;
    h.respondToConfig(() => jsonResponse(200, { ...DEFAULT_REMOTE_CONFIG, version: 9, disabledModules: [] }));
    mount({ propagateHeaders: false });
    await h.settle();
    await h.flushByTimer();
    expect(window.fetch).toBe(original);
  });

  it('remoteConfig: false never asks', async () => {
    mount({ remoteConfig: false });
    await h.flushByTimer();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.configRequests()).toEqual([]);
  });

  it('a lifted kill re-arms the tracker in the SAME page (cached kill → 200 → page views again)', async () => {
    writeCachedConfig(TEST_SCOPE, { at: Date.now() - 20 * 60_000, enabled: false, config: null });
    const view = mount();
    await h.settle();
    expect(h.configRequests()).toHaveLength(1);
    expect(getNexusStats().disabled).toBe(false);
    expect(readCachedConfig(TEST_SCOPE)?.enabled).toBe(true);
    view.rerender({ ...options, pathname: '/my-app/b' });
    await h.flushByTimer();
    const views = h.events().filter((e) => e.type === 'page_view');
    expect(views.map((e) => [e.path, (e as { nav: string }).nav])).toEqual([
      ['/my-app/a', 'load'],
      ['/my-app/b', 'route'],
    ]);
  });

  it('an in-page kill is re-checked every disabledRecheckMs and lifted by a 200', async () => {
    h.respondToConfig(() => jsonResponse(403, { error: { code: 'BROWSER_INGEST_DISABLED' } }));
    const view = mount();
    await h.settle();
    expect(getNexusStats().disabled).toBe(true);
    h.respondToConfig(() => jsonResponse(200, DEFAULT_REMOTE_CONFIG));
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(h.configRequests()).toHaveLength(2);
    expect(getNexusStats().disabled).toBe(false);
    view.rerender({ ...options, pathname: '/my-app/b' });
    await h.flushByTimer();
    expect(h.events().some((e) => e.type === 'page_view' && e.path === '/my-app/b')).toBe(true);
  });

  it('a config body that stalls after the headers times out: later refreshes and the replay still run', async () => {
    h.respondToConfig(
      () =>
        new Response(
          new ReadableStream({
            start() {
              // headers sent, body never arrives
            },
          }),
          { status: 200 },
        ),
    );
    mount();
    await vi.advanceTimersByTimeAsync(10_000); // past configTimeoutMs (and the hard deadline)
    expect(h.configRequests()).toHaveLength(1);
    h.respondToConfig(() => jsonResponse(200, { ...DEFAULT_REMOTE_CONFIG, version: 7 }));
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(h.configRequests()).toHaveLength(2);
    expect(globalState().remote.get(TEST_SCOPE)?.version).toBe(7);
  });

  it('a kill code on ingest disables the tracker in this page', async () => {
    h.respondToIngest(() => jsonResponse(403, { error: { code: 'APP_DISABLED' } }));
    mount();
    await h.flushByTimer();
    const sentBefore = h.sent().length;
    globalState().active!.trackTool('a.b');
    await h.flushByTimer();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.sent()).toHaveLength(sentBefore);
    expect(readCachedConfig(TEST_SCOPE)?.enabled).toBe(false);
  });
});
