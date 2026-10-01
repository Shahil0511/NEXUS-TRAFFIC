import { INGEST_HEADERS } from '@nexus/shared';
import express, { type Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { currentRequestId } from '../../context/request-context';
import { requestContextMiddleware } from './request-context.middleware';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEADER = INGEST_HEADERS.requestId.toLowerCase();

function buildApp(): Express {
  const app = express();
  app.use(requestContextMiddleware());
  app.get('/probe', async (_req, res) => {
    await new Promise((resolve) => setImmediate(resolve));
    res.json({ locals: res.locals.requestId, context: currentRequestId() ?? null });
  });
  return app;
}

describe('requestContextMiddleware', () => {
  const app = buildApp();

  it('accepts a safe inbound X-Request-ID and echoes it', async () => {
    const res = await request(app).get('/probe').set(INGEST_HEADERS.requestId, 'abc-123_x.y');
    expect(res.headers[HEADER]).toBe('abc-123_x.y');
    expect(res.body).toEqual({ locals: 'abc-123_x.y', context: 'abc-123_x.y' });
  });

  it('replaces an unsafe inbound id with a generated uuid', async () => {
    for (const unsafe of ['has space', 'injecté', 'x'.repeat(129), '<script>']) {
      const res = await request(app).get('/probe').set(INGEST_HEADERS.requestId, unsafe);
      expect(res.headers[HEADER]).toMatch(UUID);
      expect(res.body.locals).toBe(res.headers[HEADER]);
    }
  });

  it('generates an id when none is sent and keeps it across async hops', async () => {
    const res = await request(app).get('/probe');
    expect(res.headers[HEADER]).toMatch(UUID);
    expect(res.body.context).toBe(res.headers[HEADER]);
  });
});
