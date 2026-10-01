import { ERROR_CODES, INGEST_HEADERS } from '@nexus/shared';
import express, { type Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { recordingLogger, type LogCall } from '../../../test/fixtures/recording-logger';
import { ConflictError, RateLimitedError, ValidationError } from '../../errors/app-error';
import { errorHandlerMiddleware, notFoundMiddleware } from './error-handler.middleware';
import { requestContextMiddleware } from './request-context.middleware';

function buildApp(): { app: Express; calls: LogCall[] } {
  const { logger, calls } = recordingLogger();
  const app = express();
  app.use(requestContextMiddleware());
  app.get('/conflict', () => {
    throw new ConflictError('App "x" already exists');
  });
  app.get('/validation', () => {
    throw new ValidationError('Invalid request body', [{ path: 'slug', message: 'bad' }]);
  });
  app.get('/rate-limited', () => {
    throw new RateLimitedError(42);
  });
  app.get('/async-crash', async () => {
    throw new Error('secret connection string postgres://user:pw@db');
  });
  app.get('/db-down', async () => {
    throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), { code: '08006' });
  });
  app.post('/json', express.json({ limit: '10b' }), (_req, res) => {
    res.json({ ok: true });
  });
  app.use(notFoundMiddleware());
  app.use(errorHandlerMiddleware(logger));
  return { app, calls };
}

describe('errorHandlerMiddleware', () => {
  it('renders an AppError with its code, message and requestId', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/conflict').set(INGEST_HEADERS.requestId, 'req-123');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: {
        code: ERROR_CODES.CONFLICT,
        message: 'App "x" already exists',
        requestId: 'req-123',
      },
    });
  });

  it('includes details when the error has them', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/validation');
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: 'slug', message: 'bad' }]);
    expect(res.body.error.requestId).toBe(res.headers[INGEST_HEADERS.requestId.toLowerCase()]);
  });

  it('sets the error headers (Retry-After)', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/rate-limited');
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('42');
    expect(res.body.error.code).toBe(ERROR_CODES.RATE_LIMITED);
  });

  it('413 PAYLOAD_TOO_LARGE for a body over the parser limit', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/json')
      .set('Content-Type', 'application/json')
      .send('{"a":"0123456789"}');
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe(ERROR_CODES.PAYLOAD_TOO_LARGE);
  });

  it('400 BAD_REQUEST for malformed JSON', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/json')
      .set('Content-Type', 'application/json')
      .send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ERROR_CODES.BAD_REQUEST);
  });

  it('500 INTERNAL_ERROR for unknown errors — message NEVER leaked, but logged', async () => {
    const { app, calls } = buildApp();
    const res = await request(app).get('/async-crash');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatchObject({
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'Internal server error',
    });
    expect(JSON.stringify(res.body)).not.toContain('postgres://');
    expect(calls).toEqual([
      {
        level: 'error',
        msg: 'unhandled error',
        meta: expect.objectContaining({ method: 'GET', path: '/async-crash' }),
      },
    ]);
  });

  it('503 with Retry-After when the database is unavailable', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/db-down');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('404 NOT_FOUND for unknown routes', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(ERROR_CODES.NOT_FOUND);
  });
});
