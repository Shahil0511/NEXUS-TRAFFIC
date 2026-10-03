/**
 * SECURITY SUITE (plan Phase 2) — part 1: no database. Part 2 (DB-backed) is
 * security.integration.test.ts next to this file.
 *
 * Every case of the plan's list, and WHERE it is proven (a case already covered elsewhere is
 * referenced, not duplicated):
 *
 * | Case                                        | Proven in                                                        |
 * |---------------------------------------------|------------------------------------------------------------------|
 * | forged leftmost X-Forwarded-For             | here (per-IP failure limiter) + security.integration (stored IP) |
 * |                                             | + packages/shared/src/ingest/client-ip.test.ts (SDK resolver)    |
 * | Origin: null / foreign Origin — HTTP        | test/e2e/ingest.integration.test.ts ("a foreign Origin, …")      |
 * |                                             | + src/http/middleware/origin-guard.middleware.test.ts            |
 * | Origin: null / foreign Origin — socket      | test/e2e/live-socket.test.ts ("refuses a foreign Origin …")      |
 * | secret key on the browser endpoint          | test/e2e/ingest.integration.test.ts (403 + exposed_at set)       |
 * | revoked key rejected on the NEXT request    | security.integration (cache invalidated by the revoke)           |
 * | cross-app session_id                        | security.integration (replay never mixes apps)                   |
 * | expired / forged / revoked socket token     | here (handshake) + src/live/socket-auth.middleware.test.ts       |
 * |                                             | (sweeper ends a session whose token expired or was revoked)      |
 * | `javascript:` path rejected                 | here (contract schemas) + security.integration (HTTP + DB CHECK) |
 * | poison-row bisect                           | src/services/ingest.service.integration.test.ts (real CHECK)     |
 * | 23514 missing-partition retry               | src/services/ingest.service.integration.test.ts (real DB)        |
 * | non-admin never receives an IP              | test/e2e/dashboard.integration.test.ts, src/domain/mappers.test.ts, |
 * |                                             | src/live/live.broadcaster.test.ts                                |
 * | CSRF header on admin mutations              | here (every non-GET apps.* leaf)                                 |
 */
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';

import { ACCESS_TOKEN_COOKIE } from '@nexus/auth';
import {
  BROWSER_BATCH_EXAMPLE,
  browserEventSchema,
  buildPath,
  ERROR_CODES,
  INGEST_HEADERS,
  ROUTES,
  SERVER_BATCH_EXAMPLE,
  serverEventSchema,
  SOCKET_NAMESPACES,
  SOCKET_PATH,
} from '@nexus/shared';
import type { Express } from 'express';
import { io as connect, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { API_MOUNT_PATH, createApp } from '../../src/app';
import { parseConfig } from '../../src/config';
import { createContainer, type Container } from '../../src/container';
import { createRealtime, type Realtime } from '../../src/socket';
import { signAccessToken } from '../fixtures/sign-access-token';
import { silentLogger } from '../ingest-fixtures';

const JWT_SECRET = 'security-suite-jwt-secret-'.padEnd(48, 'x');
const ADMIN_EMAIL = 'admin@libas.in';
const VIEWER_EMAIL = 'viewer@libas.in';
const PUBLIC_ORIGIN = 'https://nexus.libas.in';
const IP_FAILURES_PER_MIN = 3;

const url = (path: string) => `${API_MOUNT_PATH}${path}`;

function tokenFor(email: string, expiresInSeconds = 3600, secret = JWT_SECRET): string {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  return signAccessToken({ email, type: 'access', exp }, secret);
}

function cookieFor(email: string, expiresInSeconds?: number, secret?: string): string {
  return `${ACCESS_TOKEN_COOKIE}=${tokenFor(email, expiresInSeconds, secret)}`;
}

let container: Container;
let app: Express;
let server: HttpServer;
let realtime: Realtime;
let baseUrl: string;

beforeAll(async () => {
  const config = parseConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    // Never connected: every case below is decided before a repository is reached.
    DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:1/none',
    LIBAS_JWT_SECRET: JWT_SECRET,
    PUBLIC_ORIGIN,
    DASHBOARD_ADMIN_EMAILS: ADMIN_EMAIL,
    TRUST_PROXY_HOPS: '1',
    INGEST_IP_FAILURE_PER_MIN: String(IP_FAILURES_PER_MIN),
    API_KEY_PEPPER: 'a'.repeat(64),
    USER_KEY_SECRET: 'b'.repeat(64),
    IP_HASH_SECRET: 'c'.repeat(64),
  });
  container = createContainer(config, { logger: silentLogger() });
  app = createApp(container);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  realtime = createRealtime(server, container);
});

afterAll(async () => {
  await realtime.close();
  await Promise.all([container.pools.write.end(), container.pools.query.end()]);
});

// ─── CSRF: X-Nexus-Dashboard on every admin mutation ────────────────────────

const ADMIN_MUTATIONS = Object.entries(ROUTES.apps)
  .filter(([, route]) => route.method !== 'GET')
  .map(([leaf, route]) => ({
    leaf,
    route,
    path: url(buildPath(route, { slug: 'ebo-sales', keyId: randomUUID() })),
  }));

function send(method: string, path: string): request.Test {
  const agent = request(app);
  switch (method) {
    case 'POST':
      return agent.post(path);
    case 'PATCH':
      return agent.patch(path);
    case 'PUT':
      return agent.put(path);
    case 'DELETE':
      return agent.delete(path);
    default:
      throw new Error(`unexpected method ${method}`);
  }
}

describe('security: admin mutations require the CSRF header and an admin', () => {
  it('covers every non-GET apps.* leaf (create, update, createKey, expireKey, revokeKey)', () => {
    expect(ADMIN_MUTATIONS.map((m) => m.leaf).sort()).toEqual(
      ['create', 'createKey', 'expireKey', 'revokeKey', 'update'].sort(),
    );
  });

  it.each(ADMIN_MUTATIONS)(
    '$leaf: admin cookie WITHOUT X-Nexus-Dashboard → 403 CSRF_HEADER_MISSING',
    async ({ route, path }) => {
      const res = await send(route.method, path).set('Cookie', cookieFor(ADMIN_EMAIL)).send({});
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(ERROR_CODES.CSRF_HEADER_MISSING);
    },
  );

  it.each(ADMIN_MUTATIONS)(
    '$leaf: header but a NON-admin → 403 FORBIDDEN',
    async ({ route, path }) => {
      const res = await send(route.method, path)
        .set('Cookie', cookieFor(VIEWER_EMAIL))
        .set(INGEST_HEADERS.dashboard, '1')
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(ERROR_CODES.FORBIDDEN);
    },
  );

  it.each(ADMIN_MUTATIONS)('$leaf: no cookie → 401', async ({ route, path }) => {
    const res = await send(route.method, path).set(INGEST_HEADERS.dashboard, '1').send({});
    expect(res.status).toBe(401);
  });
});

// ─── Forged leftmost X-Forwarded-For ────────────────────────────────────────

describe('security: a forged leftmost X-Forwarded-For never changes the client IP', () => {
  function verifyWithBadKey(xff: string) {
    return request(app)
      .get(url(ROUTES.ingest.verify.path))
      .set(INGEST_HEADERS.key, 'nx_sk_forged')
      .set('X-Forwarded-For', xff);
  }

  it(`a key guesser rotating the LEFTMOST hop is still blocked after ${IP_FAILURES_PER_MIN} failures`, async () => {
    const statuses: number[] = [];
    for (let i = 0; i <= IP_FAILURES_PER_MIN; i += 1) {
      statuses.push((await verifyWithBadKey(`10.9.8.${i}, 198.51.100.7`)).status);
    }
    expect(statuses).toEqual([...Array(IP_FAILURES_PER_MIN).fill(401), 429]);
  });

  it('another real client (the hop our nginx appends) keeps its own budget', async () => {
    const res = await verifyWithBadKey('198.51.100.7, 198.51.100.8');
    expect(res.status).toBe(401);
  });
});

// ─── `javascript:` paths ────────────────────────────────────────────────────

describe('security: `javascript:` (or any non-absolute) path is rejected by the contract', () => {
  const serverEvent = SERVER_BATCH_EXAMPLE.events[0];
  const pageView = BROWSER_BATCH_EXAMPLE.events[0];

  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'data:text/html,x',
    'https://evil.example/x',
  ])('server path / routeTemplate %s', (bad) => {
    expect(serverEventSchema.safeParse({ ...serverEvent, path: bad }).success).toBe(false);
    expect(serverEventSchema.safeParse({ ...serverEvent, routeTemplate: bad }).success).toBe(false);
  });

  it('browser page path', () => {
    expect(browserEventSchema.safeParse({ ...pageView, path: 'javascript:alert(1)' }).success).toBe(
      false,
    );
    expect(browserEventSchema.safeParse(pageView).success).toBe(true);
  });
});

// ─── Socket tokens ──────────────────────────────────────────────────────────

describe('security: the live socket refuses bad tokens at the handshake', () => {
  const sockets: Socket[] = [];

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.close();
  });

  function connectError(cookie: string): Promise<Error | 'connected'> {
    const socket = connect(`${baseUrl}${SOCKET_NAMESPACES.live}`, {
      path: SOCKET_PATH,
      transports: ['websocket'],
      extraHeaders: { Cookie: cookie, Origin: PUBLIC_ORIGIN },
      reconnection: false,
      forceNew: true,
    });
    sockets.push(socket);
    return new Promise((resolve) => {
      socket.once('connect', () => resolve('connected'));
      socket.once('connect_error', resolve);
    });
  }

  it('a valid token connects (control)', async () => {
    expect(await connectError(cookieFor(ADMIN_EMAIL))).toBe('connected');
  });

  it('an EXPIRED token is refused', async () => {
    expect(await connectError(cookieFor(ADMIN_EMAIL, -120))).toBeInstanceOf(Error);
  });

  it('a token signed with another secret (forged) is refused', async () => {
    expect(
      await connectError(cookieFor(ADMIN_EMAIL, 3600, 'not-the-portal-secret'.padEnd(48, 'y'))),
    ).toBeInstanceOf(Error);
  });

  it('a valid token of an address the policy does not allow is refused', async () => {
    expect(await connectError(cookieFor('outsider@example.com'))).toBeInstanceOf(Error);
  });
});
