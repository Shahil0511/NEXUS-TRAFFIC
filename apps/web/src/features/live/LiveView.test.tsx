import {
  LIVE_AUTH_ERROR_MESSAGE,
  ROUTES,
  SOCKET_EVENTS,
  type LiveEventDto,
  type LiveSnapshotDto,
  type LiveSubscribeAck,
  type LiveTickDto,
} from '@nexus/shared';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { LiveView } from './LiveView';

// ─── A fake live socket (no network): records subscriptions, lets the test play the server ──

type Listener = (...args: unknown[]) => void;

class FakeLiveSocket {
  active = true;
  connected = false;
  readonly subscriptions: unknown[] = [];
  private listeners = new Map<string, Listener[]>();

  on(event: string, listener: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }
  /** client → server */
  emit(event: string, payload: unknown, ack?: (result: LiveSubscribeAck) => void) {
    if (event === SOCKET_EVENTS.subscribe) {
      this.subscriptions.push(payload);
      ack?.({ ok: true, scope: 'all' });
    }
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
  /** server → client */
  serverEmit(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

const sockets: FakeLiveSocket[] = [];
const latestSocket = () => sockets.at(-1)!;

vi.mock('@/lib/socket', () => ({
  createLiveSocket: () => {
    const socket = new FakeLiveSocket();
    sockets.push(socket);
    return socket;
  },
}));

const endLiveSession = vi.fn();
vi.mock('./endLiveSession', () => ({ endLiveSession: () => endLiveSession() }));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const MINUTE = '2026-10-01T10:00:00.000Z';

function tick(overrides: Partial<LiveTickDto> = {}): LiveTickDto {
  return {
    scope: 'all',
    minute: MINUTE,
    requests: 42,
    errors4xx: 3,
    errors5xx: 1,
    p95Ms: 840,
    pageViews: 5,
    toolUses: 2,
    activeUsers: 7,
    ...overrides,
  };
}

function liveEvent(overrides: Partial<LiveEventDto> = {}): LiveEventDto {
  return {
    eventId: '66666666-6666-4666-8666-666666666666',
    occurredAt: '2026-10-01T09:59:30.000Z',
    app: 'ebo-sales',
    kind: 'api',
    path: '/api/orders/42',
    method: 'GET',
    status: 502,
    durationMs: 120,
    tool: null,
    userEmail: 'amit@libas.in',
    userKey: null,
    endpointId: null,
    sessionId: null,
    ip: null,
    country: 'IN',
    city: 'Mumbai',
    ...overrides,
  };
}

const SNAPSHOT: LiveSnapshotDto = { ticks: [tick()], recent: [liveEvent()] };

function useSnapshot(onRequest?: (url: URL) => void) {
  server.use(
    http.get(routeUrl(ROUTES.live.snapshot), ({ request }) => {
      onRequest?.(new URL(request.url));
      return HttpResponse.json(SNAPSHOT);
    }),
  );
}

const metrics = () => screen.getByRole('region', { name: 'Live metrics' });
const card = (label: string) =>
  within(metrics()).getByRole('heading', { name: label }).closest('section')!;
const table = () => screen.getByRole('table', { name: /Live activity/ });

beforeEach(() => {
  sockets.length = 0;
  endLiveSession.mockReset();
});

describe('LiveView', () => {
  it('paints the snapshot, subscribes and shows the connection as live', async () => {
    useSnapshot();
    renderWithProviders(<LiveView />);

    await screen.findByText('/api/orders/42');
    expect(within(card('Requests / min')).getByText('42')).toBeInTheDocument();
    expect(within(card('Errors / min')).getByText('4')).toBeInTheDocument();
    expect(within(card('p95 latency')).getByText('840 ms')).toBeInTheDocument();
    expect(within(card('Active users')).getByText('7')).toBeInTheDocument();
    expect(latestSocket().subscriptions).toEqual([{}]);
    await vi.waitFor(() =>
      expect(screen.getAllByRole('status').map((el) => el.textContent)).toContain('Live'),
    );
  });

  it('applies ticks to the tiles and prepends streamed events', async () => {
    useSnapshot();
    renderWithProviders(<LiveView />);
    await screen.findByText('/api/orders/42');

    act(() => {
      latestSocket().serverEmit(SOCKET_EVENTS.trafficTick, tick({ requests: 50 }));
      latestSocket().serverEmit(
        SOCKET_EVENTS.trafficTick,
        tick({ scope: 'app:other', requests: 999 }),
      );
      latestSocket().serverEmit(SOCKET_EVENTS.trafficEvents, [
        liveEvent({
          eventId: '77777777-7777-4777-8777-777777777777',
          occurredAt: '2026-10-01T10:00:01.000Z',
          kind: 'tool_use',
          path: '/ebo-sales/stores',
          tool: 'export-csv',
          method: null,
          status: null,
        }),
      ]);
    });

    expect(within(card('Requests / min')).getByText('50')).toBeInTheDocument();
    const rows = within(table()).getAllByRole('row');
    // header + 2 events, newest first
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getByText('export-csv')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('/api/orders/42')).toBeInTheDocument();
  });

  it('holds new rows while paused and shows them on resume', async () => {
    useSnapshot();
    const user = userEvent.setup();
    renderWithProviders(<LiveView />);
    await screen.findByText('/api/orders/42');

    await user.click(screen.getByRole('button', { name: 'Pause' }));
    act(() => {
      latestSocket().serverEmit(SOCKET_EVENTS.trafficEvents, [
        liveEvent({ eventId: '88888888-8888-4888-8888-888888888888', path: '/api/held' }),
      ]);
    });
    expect(screen.queryByText('/api/held')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Resume (1 new)' }));
    expect(screen.getByText('/api/held')).toBeInTheDocument();
  });

  it('scopes the snapshot and the subscription to the global app filter', async () => {
    const seen: string[] = [];
    useSnapshot((url) => seen.push(url.search));
    renderWithProviders(<LiveView />, { searchParams: '?app=ebo-sales&range=7d' });
    await screen.findByText('/api/orders/42');
    expect(seen).toEqual(['?app=ebo-sales']);
    expect(latestSocket().subscriptions).toEqual([{ app: 'ebo-sales' }]);
  });

  it('sends the user back to sign in when the session ends or the handshake is refused', async () => {
    useSnapshot();
    renderWithProviders(<LiveView />);
    await screen.findByText('/api/orders/42');

    act(() => latestSocket().serverEmit(SOCKET_EVENTS.sessionExpired, { reason: 'expired' }));
    expect(endLiveSession).toHaveBeenCalledTimes(1);

    act(() => latestSocket().serverEmit('connect_error', new Error(LIVE_AUTH_ERROR_MESSAGE)));
    expect(endLiveSession).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });

  it('shows reconnecting on a dropped connection and refetches the snapshot on reconnect', async () => {
    let requests = 0;
    useSnapshot(() => (requests += 1));
    renderWithProviders(<LiveView />);
    await screen.findByText('/api/orders/42');
    expect(requests).toBe(1);

    act(() => latestSocket().serverEmit('disconnect', 'transport close'));
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument();

    act(() => latestSocket().serverEmit('connect'));
    await vi.waitFor(() => expect(requests).toBe(2));
    expect(latestSocket().subscriptions).toHaveLength(2);
  });
});
