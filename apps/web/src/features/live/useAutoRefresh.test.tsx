import { SOCKET_EVENTS, type LiveEventDto } from '@nexus/shared';
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { qk } from '@/lib/query/keys';
import { renderWithProviders } from '@/test/render';

import { AUTO_REFRESH_MIN_INTERVAL_MS } from './autoRefreshPolicy';
import { useAutoRefresh } from './useAutoRefresh';

// ─── A fake live socket (no network), same shape as LiveView.test.tsx ────────

type Listener = (...args: unknown[]) => void;

class FakeLiveSocket {
  connected = false;
  readonly subscriptions: unknown[] = [];
  private listeners = new Map<string, Listener[]>();

  on(event: string, listener: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }
  emit(event: string, payload: unknown, ack?: () => void) {
    if (event === SOCKET_EVENTS.subscribe) this.subscriptions.push(payload);
    ack?.();
    return this;
  }
  connect() {
    this.connected = true;
    this.serverEmit('connect');
    return this;
  }
  disconnect() {
    this.connected = false;
    return this;
  }
  removeAllListeners() {
    this.listeners.clear();
    return this;
  }
  serverEmit(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

const sockets: FakeLiveSocket[] = [];
vi.mock('@/lib/socket', () => ({
  createLiveSocket: () => {
    const socket = new FakeLiveSocket();
    sockets.push(socket);
    return socket;
  },
}));

const EVENT = { eventId: '66666666-6666-4666-8666-666666666666' } as LiveEventDto;

function Probe({ app, enabled }: { app?: string; enabled: boolean }) {
  useAutoRefresh({ app }, enabled);
  return null;
}

/** Seed one traffic-driven and two exempt cache entries, all fresh. */
function seed(queryClient: ReturnType<typeof renderWithProviders>['queryClient']) {
  queryClient.setQueryData(qk.overview.summary({ range: '24h' }), { seeded: true });
  queryClient.setQueryData(qk.me.get(), { seeded: true });
  queryClient.setQueryData(qk.live.snapshot({}), { seeded: true });
}

const isStale = (
  queryClient: ReturnType<typeof renderWithProviders>['queryClient'],
  key: readonly unknown[],
) => queryClient.getQueryState(key)?.isInvalidated ?? false;

beforeEach(() => {
  sockets.length = 0;
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => vi.useRealTimers());

describe('useAutoRefresh', () => {
  it('subscribes with the global app filter', () => {
    renderWithProviders(<Probe app="ebo-sales" enabled />);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.subscriptions).toEqual([{ app: 'ebo-sales' }]);
  });

  it('invalidates analytics queries — not identity or Live — when new events arrive', () => {
    const { queryClient } = renderWithProviders(<Probe enabled />);
    seed(queryClient);

    act(() => sockets[0]!.serverEmit(SOCKET_EVENTS.trafficEvents, [EVENT]));

    expect(isStale(queryClient, qk.overview.summary({ range: '24h' }))).toBe(true);
    expect(isStale(queryClient, qk.me.get())).toBe(false);
    expect(isStale(queryClient, qk.live.snapshot({}))).toBe(false);
  });

  it('throttles a burst of batches into one trailing refresh', () => {
    const { queryClient } = renderWithProviders(<Probe enabled />);
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    act(() => {
      for (let i = 0; i < 5; i += 1) sockets[0]!.serverEmit(SOCKET_EVENTS.trafficEvents, [EVENT]);
    });
    expect(spy).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(AUTO_REFRESH_MIN_INTERVAL_MS));
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('ignores empty batches', () => {
    const { queryClient } = renderWithProviders(<Probe enabled />);
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    act(() => sockets[0]!.serverEmit(SOCKET_EVENTS.trafficEvents, []));
    expect(spy).not.toHaveBeenCalled();
  });

  it('refreshes after a reconnect (events may have been missed)', () => {
    const { queryClient } = renderWithProviders(<Probe enabled />);
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    act(() => sockets[0]!.serverEmit('connect'));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('opens no socket while disabled (the Live page has its own)', () => {
    renderWithProviders(<Probe enabled={false} />);
    expect(sockets).toHaveLength(0);
  });

  it('closes the socket on unmount', () => {
    const { unmount } = renderWithProviders(<Probe enabled />);
    unmount();
    expect(sockets[0]!.connected).toBe(false);
  });
});
