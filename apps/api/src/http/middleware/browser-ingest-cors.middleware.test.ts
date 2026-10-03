import { INGEST_HEADERS } from '@nexus/shared';
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { apiKeyRow, appRow, fake, silentLogger } from '../../../test/ingest-fixtures';
import type { AppRepository } from '../../repositories/app.repository';
import { browserIngestCorsMiddleware, browserIngestPreflightMiddleware } from './browser-ingest-cors.middleware';
import { errorHandlerMiddleware } from './error-handler.middleware';

const ALLOWED = 'https://ebo.libas.in';

function setup() {
  const anyAllowsOrigin = vi.fn(async (origin: string) => origin === ALLOWED);
  const authenticated: RequestHandler = (_req, res, next) => {
    res.locals.ingest = { app: appRow({ allowed_origins: [ALLOWED] }), key: apiKeyRow({ kind: 'publishable' }) };
    next();
  };
  const app = express();
  app.use('/beacon', browserIngestPreflightMiddleware(fake<AppRepository>({ anyAllowsOrigin })));
  app.post('/beacon', authenticated, browserIngestCorsMiddleware(), (_req, res) => {
    res.status(202).json({ ok: true });
  });
  app.use(errorHandlerMiddleware(silentLogger()));
  return { app, anyAllowsOrigin };
}

describe('browserIngestPreflightMiddleware', () => {
  it('204 + reflected origin (with credentials) when some app allows the origin', async () => {
    const { app, anyAllowsOrigin } = setup();
    const res = await request(app).options('/beacon').set('Origin', ALLOWED);
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-methods']).toBe('POST');
    expect(res.headers.vary).toMatch(/Origin/);
    expect(anyAllowsOrigin).toHaveBeenCalledWith(ALLOWED);
  });

  it('204 WITHOUT CORS headers for an unknown or opaque origin (the browser then blocks)', async () => {
    const { app, anyAllowsOrigin } = setup();
    const foreign = await request(app).options('/beacon').set('Origin', 'https://evil.example');
    expect(foreign.status).toBe(204);
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
    const opaque = await request(app).options('/beacon').set('Origin', 'null');
    expect(opaque.headers['access-control-allow-origin']).toBeUndefined();
    expect(anyAllowsOrigin).toHaveBeenCalledTimes(1);
  });

  it('leaves non-OPTIONS requests to the route', async () => {
    const { app, anyAllowsOrigin } = setup();
    expect((await request(app).post('/beacon').set('Origin', ALLOWED)).status).toBe(202);
    expect(anyAllowsOrigin).not.toHaveBeenCalled();
  });
});

describe('browserIngestCorsMiddleware', () => {
  it('reflects ONLY an origin listed in the allowed_origins of the app, never *', async () => {
    const { app } = setup();
    const ok = await request(app).post('/beacon').set('Origin', ALLOWED);
    expect(ok.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    expect(ok.headers['access-control-expose-headers']).toContain(INGEST_HEADERS.contract);

    const foreign = await request(app).post('/beacon').set('Origin', 'https://evil.example');
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
    expect(foreign.headers.vary).toMatch(/Origin/);
  });
});
