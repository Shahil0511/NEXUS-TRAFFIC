/**
 * S4 end to end over a REAL Socket.io connection, in process: the real container, app and
 * createRealtime on an ephemeral port, and `socket.io-client` as the browser.
 *
 * WHY: proves the wiring unit tests cannot — allowRequest (Origin rules) → namespace auth (SSO
 * cookie + policy) → live:subscribe → a committed row handed to LiveFeed (exactly what
 * IngestService.publishLive does after COMMIT) → `traffic:tick` within LIVE_TICK_MS (the S4 exit
 * check) and a role-masked `traffic:events` batch. No database: subscribing to "all apps" needs no
 * app lookup and LiveFeed is in-memory.
 */
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { ACCESS_TOKEN_COOKIE } from '@nexus/auth';
import {
  LIVE_AUTH_ERROR_MESSAGE,
  LIVE_TICK_MS,
  SOCKET_EVENTS,
  SOCKET_NAMESPACES,
  SOCKET_PATH,
  type ClientToServerEvents,
  type LiveEventDto,
  type LiveSubscribeAck,
  type LiveTickDto,
  type ServerToClientEvents,
} from '@nexus/shared';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app';
import { parseConfig } from '../../src/config';
import { createContainer, type Container } from '../../src/container';
import { createRealtime, type Realtime } from '../../src/socket';
import { signAccessToken } from '../fixtures/sign-access-token';
import { apiRequestInsert, LIVE_IP } from '../fixtures/live-inserts';
import { appRow, silentLogger } from '../ingest-fixtures';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const JWT_SECRET = 'e2e-live-socket-jwt-secret-'.padEnd(48, 'x');
const ADMIN_EMAIL = 'admin@libas.in';
const VIEWER_EMAIL = 'viewer@libas.in';
const PUBLIC_ORIGIN = 'https://nexus.libas.in';
/** Generous bound for timers + loopback I/O on a busy CI machine. */
const SLACK_MS = 400;

function cookieFor(email: string): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${ACCESS_TOKEN_COOKIE}=${signAccessToken({ email, type: 'access', exp }, JWT_SECRET)}`;
}

let container: Container;
let server: HttpServer;
let realtime: Realtime;
let baseUrl: string;
const clients: ClientSocket[] = [];

function client(headers: Record<string, string>): ClientSocket {
  const socket: ClientSocket = connect(`${baseUrl}${SOCKET_NAMESPACES.live}`, {
    path: SOCKET_PATH,
    transports: ['websocket'],
    extraHeaders: headers,
    reconnection: false,
    forceNew: true,
  });
  clients.push(socket);
  return socket;
}

function connectError(socket: ClientSocket): Promise<Error> {
  return new Promise((resolve) => socket.once('connect_error', resolve));
}

async function subscribed(headers: Record<string, string>): Promise<ClientSocket> {
  const socket = client(headers);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  const ack = await new Promise<LiveSubscribeAck>((resolve) =>
    socket.emit(SOCKET_EVENTS.subscribe, {}, resolve),
  );
  expect(ack).toEqual({ ok: true, scope: 'all' });
  return socket;
}

beforeAll(async () => {
  const config = parseConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    // Never connected: nothing in this suite queries the database.
    DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:1/none',
    LIBAS_JWT_SECRET: JWT_SECRET,
    PUBLIC_ORIGIN,
    DASHBOARD_ADMIN_EMAILS: ADMIN_EMAIL,
    API_KEY_PEPPER: 'a'.repeat(64),
    USER_KEY_SECRET: 'b'.repeat(64),
    IP_HASH_SECRET: 'c'.repeat(64),
  });
  container = createContainer(config, { logger: silentLogger() });
  server = createServer(createApp(container));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  realtime = createRealtime(server, container);
});

afterEach(() => {
  for (const socket of clients.splice(0)) socket.close();
});

afterAll(async () => {
  await realtime.close();
  await Promise.all([container.pools.write.end(), container.pools.query.end()]);
});

describe('live socket: handshake rules', () => {
  it('refuses a connection without the SSO cookie (generic message)', async () => {
    const err = await connectError(client({}));
    expect(err.message).toBe(LIVE_AUTH_ERROR_MESSAGE);
  });

  it('refuses a foreign Origin and Origin: null even with a valid cookie', async () => {
    for (const origin of ['https://evil.example', 'null']) {
      const socket = client({ cookie: cookieFor(ADMIN_EMAIL), origin });
      await connectError(socket);
      expect(socket.connected).toBe(false);
    }
  });

  it('accepts the dashboard Origin with a valid cookie', async () => {
    const socket = await subscribed({ cookie: cookieFor(VIEWER_EMAIL), origin: PUBLIC_ORIGIN });
    expect(socket.connected).toBe(true);
  });
});

describe('live socket: ingest → tick (S4 exit check)', () => {
  it(`delivers traffic:tick within ${LIVE_TICK_MS} ms of a committed row, and role-masked events`, async () => {
    const viewer = await subscribed({ cookie: cookieFor(VIEWER_EMAIL) });
    const admin = await subscribed({ cookie: cookieFor(ADMIN_EMAIL) });

    const recordedAt = Date.now();
    const tick = new Promise<{ tick: LiveTickDto; at: number }>((resolve) => {
      const onTick = (t: LiveTickDto) => {
        if (t.requests < 1) return;
        viewer.off(SOCKET_EVENTS.trafficTick, onTick);
        resolve({ tick: t, at: Date.now() });
      };
      viewer.on(SOCKET_EVENTS.trafficTick, onTick);
    });
    const viewerEvents = new Promise<LiveEventDto[]>((resolve) =>
      viewer.once(SOCKET_EVENTS.trafficEvents, resolve),
    );
    const adminEvents = new Promise<LiveEventDto[]>((resolve) =>
      admin.once(SOCKET_EVENTS.trafficEvents, resolve),
    );

    container.realtime.feed.recordApiRequests(appRow(), [apiRequestInsert({ statusCode: 502 })]);

    const received = await tick;
    expect(received.at - recordedAt).toBeLessThanOrEqual(LIVE_TICK_MS + SLACK_MS);
    expect(received.tick).toMatchObject({ scope: 'all', requests: 1, errors5xx: 1 });

    const [forViewer, forAdmin] = await Promise.all([viewerEvents, adminEvents]);
    expect(forViewer).toHaveLength(1);
    expect(forViewer[0]).toMatchObject({ app: 'ebo-sales', kind: 'api', status: 502, ip: null });
    expect(forAdmin[0]?.ip).toBe(LIVE_IP);
  }, 10_000);
});
