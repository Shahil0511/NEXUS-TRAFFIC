import { ERROR_CODES, INGEST_HEADERS } from '@nexus/shared';
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { apiKeyRow, appRow, fake, silentLogger } from '../../../test/ingest-fixtures';
import { AllowedOriginCache } from '../../auth/allowed-origin.cache';
import { UnauthorizedError } from '../../errors/app-error';
import { FixedClock } from '../../lib/clock';
import type { AppRepository } from '../../repositories/app.repository';
import {
  browserIngestCorsMiddleware,
  browserIngestEarlyCorsMiddleware,
  browserIngestPreflightMiddleware,
} from './browser-ingest-cors.middleware';
import { errorHandlerMiddleware } from './error-handler.middleware';

const ALLOWED = 'https://ebo.libas.in';

function setup() {
  const anyAllowsOrigin = vi.fn(async (origin: string) => origin === ALLOWED);
  const origins = new AllowedOriginCache(fake<AppRepository>({ anyAllowsOrigin }), new FixedClock(new Date()));
  const authenticated: RequestHandler = (_req, res, next) => {
    res.locals.ingest = { app: appRow({ allowed_origins: [ALLOWED] }), key: apiKeyRow({ kind: 'publishable' }) };
    next();
  };
  const app = express();
  app.use('/beacon', browserIngestPreflightMiddleware(origins));
  app.post('/beacon', authenticated, browserIngestCorsMiddleware(), (_req, res) => {
    res.status(202).json({ ok: true });
  });
  // A route that fails BEFORE auth (e.g. a bad key) behind the early CORS step.
  app.post('/early', browserIngestEarlyCorsMiddleware(origins), () => {
    throw new UnauthorizedError('bad key', ERROR_CODES.INVALID_API_KEY);
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

  it('answers repeated preflights from the cache (one lookup per origin per TTL)', async () => {
    const { app, anyAllowsOrigin } = setup();
    await request(app).options('/beacon').set('Origin', ALLOWED);
    await request(app).options('/beacon').set('Origin', ALLOWED);
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

describe('browserIngestEarlyCorsMiddleware (pre-auth, ADR 0009)', () => {
  it('a pre-auth error is readable by a REGISTERED origin (ACAO + ACAC + exposed headers)', async () => {
    const { app } = setup();
    const res = await request(app).post('/early').set('Origin', ALLOWED);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(ERROR_CODES.INVALID_API_KEY);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-expose-headers']).toContain('Retry-After');
    expect(res.headers.vary).toMatch(/Origin/);
  });

  it('nothing is reflected for an unregistered, opaque or missing origin', async () => {
    const { app } = setup();
    for (const origin of ['https://evil.example', 'null']) {
      const res = await request(app).post('/early').set('Origin', origin);
      expect(res.status).toBe(401);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    }
    expect((await request(app).post('/early')).headers['access-control-allow-origin']).toBeUndefined();
  });

  it('a failing origin lookup only means no headers', async () => {
    const origins = new AllowedOriginCache(
      fake<AppRepository>({ anyAllowsOrigin: async () => Promise.reject(new Error('db down')) }),
      new FixedClock(new Date()),
    );
    const app = express();
    app.post('/early', browserIngestEarlyCorsMiddleware(origins), (_req, res) => {
      res.status(202).json({ ok: true });
    });
    const res = await request(app).post('/early').set('Origin', ALLOWED);
    expect(res.status).toBe(202);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
