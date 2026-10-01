import http from 'node:http';
import type { AddressInfo } from 'node:net';

import type { NexusClient, NexusServerEvent } from '@nexus/node';
import express5, { type Request as Request5 } from 'express';
import express4, { type Request as Request4 } from 'express4';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { nexusMiddleware } from './middleware';
import type { NexusMiddlewareOptions } from './types';

// ─── Helpers ────────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SESSION_ID = '0b9f5c1e-2a43-4c4e-9d1a-6f2b8c3d4e5f';
const PAGE_VIEW_ID = '1c0a6d2f-3b54-4d5f-8e2b-7a3c9d4e5f60';

/** A recording fake of the Nexus client. */
function fakeClient(): NexusClient & { events: NexusServerEvent[] } {
  const events: NexusServerEvent[] = [];
  return {
    events,
    track: (event) => {
      events.push(event);
    },
    flush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
    stats: () => ({ queued: 0, accepted: 0, duplicates: 0, rejected: 0, dropped: 0, attempts: 0, paused: false, enabled: true }),
    trustProxyHops: 1,
    sdk: { name: 'test', version: '1.0.0' },
  };
}

// The two Express majors share the API we use; typed loosely so one suite drives both.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExpressFactory = (() => any) & { Router: () => any };

const FLAVOURS: Array<[string, ExpressFactory]> = [
  ['express 5', express5 as unknown as ExpressFactory],
  ['express 4', express4 as unknown as ExpressFactory],
];

/** An app with a few representative routes behind the middleware. */
function buildApp(express: ExpressFactory, options: Partial<NexusMiddlewareOptions> = {}) {
  const client = fakeClient();
  const app = express();
  app.use(nexusMiddleware({ client, ...options } as NexusMiddlewareOptions));

  const agreements = express.Router();
  agreements.get('/:id', (req: { params: { id: string } }, res: { json: (b: unknown) => void }) =>
    res.json({ id: req.params.id }),
  );
  agreements.post('/', (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) =>
    res.status(201).json({ ok: true }),
  );
  const api = express.Router();
  api.use('/agreements', agreements);
  app.use('/api', api);

  app.get('/me', (_req: unknown, res: { json: (b: unknown) => void }) => res.json({ ok: true }));
  app.get('/health', (_req: unknown, res: { send: (b: string) => void }) => res.send('ok'));
  app.get('/assets/app.js', (_req: unknown, res: { send: (b: string) => void }) => res.send('js'));
  app.get('/sse', (_req: unknown, res: { setHeader: (k: string, v: string) => void; end: (b: string) => void }) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.end('data: hi\n\n');
  });
  app.get('/download', (_req: unknown, res: { attachment: (f: string) => void; send: (b: string) => void }) => {
    res.attachment('report.csv');
    res.send('a,b');
  });
  app.get('/fail', (_req: unknown, res: { locals: Record<string, unknown>; status: (n: number) => { json: (b: unknown) => void } }) => {
    res.locals['errorCode'] = 'VALIDATION_ERROR';
    res.status(422).json({ error: 'x' });
  });
  app.get('/slow', () => {
    // never answers: the client hangs up first
  });
  return { app, client };
}

async function oneEvent(client: { events: NexusServerEvent[] }): Promise<NexusServerEvent> {
  await vi.waitFor(() => expect(client.events).toHaveLength(1));
  return client.events[0]!;
}

/** Give a skipped request time to (not) be recorded. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

// ─── Typings ────────────────────────────────────────────────────────────────

describe('typings', () => {
  it('is accepted by app.use on Express 5 and Express 4 typings, with a typed getUser', () => {
    const app5 = express5();
    app5.use(nexusMiddleware({ client: fakeClient(), getUser: (req: Request5) => req.get('x-user-email') }));
    const app4 = express4();
    app4.use(nexusMiddleware({ client: fakeClient(), getUser: (req: Request4) => req.get('x-user-email') }));
    app4.use(nexusMiddleware({ client: fakeClient() }));
    expect(typeof app5).toBe('function');
  });
});

// ─── Suites ─────────────────────────────────────────────────────────────────

describe.each(FLAVOURS)('nexusMiddleware on %s', (_name, express) => {
  it('records a complete server event for a nested-router request', async () => {
    const { app, client } = buildApp(express);
    await request(app)
      .get('/api/agreements/42?secret=token')
      .set('User-Agent', 'vitest-agent')
      .set('X-Request-ID', 'req-123')
      .set('X-Nexus-Session', SESSION_ID)
      .set('X-Nexus-Page-View', PAGE_VIEW_ID)
      .expect(200);
    const event = await oneEvent(client);
    expect(event).toMatchObject({
      kind: 'http',
      method: 'GET',
      path: '/api/agreements/42',
      routeTemplate: '/api/agreements/:id',
      status: 200,
      requestId: 'req-123',
      userAgent: 'vitest-agent',
      sessionId: SESSION_ID,
      pageViewId: PAGE_VIEW_ID,
    });
    expect(event.eventId).toMatch(UUID);
    expect(Number.isNaN(Date.parse(event.occurredAt))).toBe(false);
    expect(event.durationMs).toBeGreaterThanOrEqual(0);
    expect(event.responseBytes).toBeGreaterThan(0);
    expect(event.ip).toBeTruthy();
    expect(JSON.stringify(event)).not.toContain('secret');
  });

  it('templates a router root route as the mount path', async () => {
    const { app, client } = buildApp(express);
    await request(app).post('/api/agreements').send({ a: 1 }).expect(201);
    const event = await oneEvent(client);
    expect(event).toMatchObject({ method: 'POST', routeTemplate: '/api/agreements', status: 201 });
    expect(event.requestBytes).toBeGreaterThan(0);
  });

  it('leaves routeTemplate undefined for an unmatched path (404)', async () => {
    const { app, client } = buildApp(express);
    await request(app).get('/nope/123').expect(404);
    const event = await oneEvent(client);
    expect(event).toMatchObject({ path: '/nope/123', status: 404 });
    expect(event.routeTemplate).toBeUndefined();
  });

  it('prefixes basePath to path and template when the gateway strips it', async () => {
    const { app, client } = buildApp(express, { basePath: '/ebo-sales/' });
    await request(app).get('/api/agreements/7').expect(200);
    const event = await oneEvent(client);
    expect(event).toMatchObject({ path: '/ebo-sales/api/agreements/7', routeTemplate: '/ebo-sales/api/agreements/:id' });
  });

  it('does not double basePath when the app itself is mounted under it', async () => {
    const client = fakeClient();
    const app = express();
    app.use(nexusMiddleware({ client, basePath: '/ebo-sales' }));
    const router = express.Router();
    router.get('/stores/:id', (_req: unknown, res: { json: (b: unknown) => void }) => res.json({}));
    app.use('/ebo-sales/api', router);
    await request(app).get('/ebo-sales/api/stores/9').expect(200);
    const event = await oneEvent(client);
    expect(event).toMatchObject({ path: '/ebo-sales/api/stores/9', routeTemplate: '/ebo-sales/api/stores/:id' });
  });

  it('reads the user with getUser (default req.user.email)', async () => {
    const client = fakeClient();
    const app = express();
    app.use((req: { user?: unknown }, _res: unknown, next: () => void) => {
      req.user = { email: 'shahil@libas.in' };
      next();
    });
    app.use(nexusMiddleware({ client }));
    app.get('/me', (_req: unknown, res: { json: (b: unknown) => void }) => res.json({}));
    await request(app).get('/me').expect(200);
    expect((await oneEvent(client)).userEmail).toBe('shahil@libas.in');
  });

  it('IGNORES a forged X-Nexus-User header by default', async () => {
    const { app, client } = buildApp(express);
    await request(app).get('/me').set('X-Nexus-User', 'ceo@libas.in').expect(200);
    expect((await oneEvent(client)).userEmail).toBeUndefined();
  });

  it('reads X-Nexus-User only with trustIdentityHeader: true', async () => {
    const { app, client } = buildApp(express, { trustIdentityHeader: true });
    await request(app).get('/me').set('X-Nexus-User', 'gateway@libas.in').expect(200);
    expect((await oneEvent(client)).userEmail).toBe('gateway@libas.in');
  });

  it('resolves the client IP from the right with trustProxyHops', async () => {
    const one = buildApp(express, { trustProxyHops: 1 });
    await request(one.app).get('/me').set('X-Forwarded-For', '6.6.6.6, 203.0.113.9').expect(200);
    expect((await oneEvent(one.client)).ip).toBe('203.0.113.9');
    const two = buildApp(express, { trustProxyHops: 2 });
    await request(two.app).get('/me').set('X-Forwarded-For', '6.6.6.6, 203.0.113.9').expect(200);
    expect((await oneEvent(two.client)).ip).toBe('6.6.6.6');
  });

  it.each([
    ['OPTIONS preflight', 'options', '/api/agreements/1'],
    ['health check', 'get', '/health'],
    ['static asset', 'get', '/assets/app.js'],
    ['next asset', 'get', '/_next/static/chunk.css'],
  ])('skips %s by default', async (_label, method, path) => {
    const { app, client } = buildApp(express);
    await (request(app) as unknown as Record<string, (p: string) => Promise<unknown>>)[method]!(path);
    await settle();
    expect(client.events).toHaveLength(0);
  });

  it('extraSkip adds to the default rule; skip replaces it', async () => {
    const extra = buildApp(express, { extraSkip: (req) => (req.originalUrl ?? '').startsWith('/me') });
    await request(extra.app).get('/me');
    await request(extra.app).get('/health');
    await settle();
    expect(extra.client.events).toHaveLength(0);

    const replaced = buildApp(express, { skip: () => false });
    await request(replaced.app).get('/health');
    expect((await oneEvent(replaced.client)).path).toBe('/health');
  });

  it('detects streams (SSE and downloads); classify overrides', async () => {
    const sse = buildApp(express);
    await request(sse.app).get('/sse').expect(200);
    expect((await oneEvent(sse.client)).kind).toBe('stream');

    const download = buildApp(express);
    await request(download.app).get('/download').expect(200);
    expect((await oneEvent(download.client)).kind).toBe('stream');

    const forced = buildApp(express, { classify: () => 'http' });
    await request(forced.app).get('/sse').expect(200);
    expect((await oneEvent(forced.client)).kind).toBe('http');
  });

  it('reads the error code from res.locals.errorCode', async () => {
    const { app, client } = buildApp(express);
    await request(app).get('/fail').expect(422);
    expect(await oneEvent(client)).toMatchObject({ status: 422, errorCode: 'VALIDATION_ERROR' });
  });

  it('records 499 when the client hangs up before the response', async () => {
    const { app, client } = buildApp(express);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const req = http.get({ host: '127.0.0.1', port, path: '/slow' });
    req.on('error', () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    req.destroy();
    try {
      const event = await oneEvent(client);
      expect(event).toMatchObject({ path: '/slow', status: 499, routeTemplate: '/slow' });
    } finally {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('records exactly one event per request (finish + close)', async () => {
    const { app, client } = buildApp(express);
    await request(app).get('/me').expect(200);
    await settle();
    expect(client.events).toHaveLength(1);
  });

  it('never mutates req.query and swallows throwing callbacks and clients', async () => {
    const client = fakeClient();
    client.track = () => {
      throw new Error('client down');
    };
    const app = express();
    app.use(
      nexusMiddleware({
        client,
        getUser: () => {
          throw new Error('getUser bug');
        },
        classify: () => {
          throw new Error('classify bug');
        },
      }),
    );
    app.get('/q', (req: { query: unknown }, res: { json: (b: unknown) => void }) => res.json(req.query));
    const response = await request(app).get('/q?a=1&b=2').expect(200);
    expect(response.body).toEqual({ a: '1', b: '2' });
  });

  it('passes through when skip throws', async () => {
    const { app, client } = buildApp(express, {
      skip: () => {
        throw new Error('skip bug');
      },
    });
    await request(app).get('/me').expect(200);
    await settle();
    expect(client.events).toHaveLength(0);
  });
});
