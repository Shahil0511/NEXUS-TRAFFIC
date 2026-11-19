/**
 * WHY: the middleware builds events by hand (no zod in the bundle), so this proves — end to end,
 * through real Express apps and this package's own client — that what goes on the wire is
 * accepted by the public contract (`serverIngestBatchSchema`).
 */
import { serverIngestBatchSchema } from '@nexus/shared';
import express5 from 'express';
import express4 from 'express4';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNexusClient, EXPRESS_SDK, nexusMiddleware } from './index';

afterEach(() => {
  vi.unstubAllEnvs();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExpressFactory = (() => any) & { Router: () => any };

const FLAVOURS: Array<[string, ExpressFactory]> = [
  ['express 5', express5 as unknown as ExpressFactory],
  ['express 4', express4 as unknown as ExpressFactory],
];

/** A fetch stub that records every request body and answers 202 like the real ingest API. */
function recordingFetch(): { bodies: unknown[]; fetch: typeof fetch } {
  const bodies: unknown[] = [];
  const stub = async (_url: unknown, init?: { body?: unknown }): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as { events: unknown[] };
    bodies.push(body);
    return new Response(JSON.stringify({ accepted: body.events.length, duplicates: 0, rejected: [] }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { bodies, fetch: stub as unknown as typeof fetch };
}

/** An app exercising every event kind the middleware can emit. */
function buildApp(express: ExpressFactory, client: ReturnType<typeof createNexusClient>) {
  const app = express();
  app.use((req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { email: 'someone@libas.in' };
    next();
  });
  app.use(nexusMiddleware({ client, basePath: '/my-app', release: 'v1.2.3' }));
  const api = express.Router();
  api.get('/stores/:id', (req: { params: { id: string } }, res: { json: (b: unknown) => void }) =>
    res.json({ id: req.params.id }),
  );
  api.post('/stores', (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) =>
    res.status(201).json({ ok: true }),
  );
  app.use('/api', api);
  app.get('/fail', (_req: unknown, res: { locals: Record<string, unknown>; status: (n: number) => { json: (b: unknown) => void } }) => {
    res.locals['errorCode'] = 'VALIDATION_ERROR';
    res.status(422).json({ error: 'x' });
  });
  app.get('/sse', (_req: unknown, res: { setHeader: (k: string, v: string) => void; end: (b: string) => void }) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.end('data: hi\n\n');
  });
  return app;
}

describe.each(FLAVOURS)('middleware events on %s', (_name, express) => {
  it('validate against serverIngestBatchSchema on the wire', async () => {
    const { bodies, fetch } = recordingFetch();
    const client = createNexusClient({
      url: 'http://localhost:4000',
      key: 'nx_sk_test_0123456789abcdef',
      fetch,
      flushIntervalMs: 60_000,
    });
    const app = buildApp(express, client);

    await request(app).get('/api/stores/42').set('X-Request-Id', 'req-1').set('User-Agent', 'Mozilla/5.0');
    await request(app).post('/api/stores').send({ name: 'x' });
    await request(app).get('/fail');
    await request(app).get('/sse');
    await request(app).get('/nope');
    await client.flush();

    expect(bodies.length).toBeGreaterThan(0);
    let total = 0;
    for (const body of bodies) {
      const result = serverIngestBatchSchema.safeParse(body);
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
      total += (body as { events: unknown[] }).events.length;
    }
    expect(total).toBe(5);
    await client.shutdown(100);
  });

  it('environment (NEXUS_ENVIRONMENT) and release (NEXUS_RELEASE) from the env validate on the wire', async () => {
    vi.stubEnv('NEXUS_ENVIRONMENT', 'staging');
    vi.stubEnv('NEXUS_RELEASE', '2026.11.18-a1b2c3d');
    const { bodies, fetch } = recordingFetch();
    const client = createNexusClient({ url: 'http://localhost:4000', key: 'nx_sk_test_0123456789abcdef', fetch });
    const app = express();
    app.use(nexusMiddleware({ client }));
    app.get('/x', (_req: unknown, res: { json: (b: unknown) => void }) => res.json({}));
    await request(app).get('/x');
    await client.flush();
    const parsed = serverIngestBatchSchema.safeParse(bodies[0]);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data).toMatchObject({ environment: 'staging', sdk: EXPRESS_SDK });
    expect(parsed.data?.events[0]?.release).toBe('2026.11.18-a1b2c3d');
    await client.shutdown(100);
  });
});
