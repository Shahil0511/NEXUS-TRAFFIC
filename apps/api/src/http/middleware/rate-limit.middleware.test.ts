import { ERROR_CODES } from '@nexus/shared';
import express, { type Request, type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { apiKeyRow, appRow, silentLogger } from '../../../test/ingest-fixtures';
import { errorHandlerMiddleware } from './error-handler.middleware';
import {
  clientIpKey,
  ipFailureLimitMiddleware,
  keyRateLimitMiddleware,
  retryAfterSeconds,
} from './rate-limit.middleware';

const KEY_HEADER = 'x-test-key-id';
const FAIL_HEADER = 'x-test-fail';

/** Simulates key auth: the key id comes from a test header. */
const fakeKeyAuth: RequestHandler = (req, res, next) => {
  const keyId = req.get(KEY_HEADER) ?? 'key-a';
  res.locals.ingest = { app: appRow({ id: `app-of-${keyId}` }), key: apiKeyRow({ id: keyId }) };
  next();
};

function keyLimitedApp(perMinute: number, onLimited = vi.fn()) {
  const app = express();
  app.get('/ingest', fakeKeyAuth, keyRateLimitMiddleware(perMinute, onLimited, 'server'), (_req, res) => {
    res.status(202).json({ ok: true });
  });
  app.use(errorHandlerMiddleware(silentLogger()));
  return { app, onLimited };
}

function ipLimitedApp(perMinute: number) {
  const app = express();
  app.get('/ingest', ipFailureLimitMiddleware(perMinute), (req, res) => {
    const fail = req.get(FAIL_HEADER);
    if (fail) res.status(Number(fail)).json({ error: 'auth' });
    else res.status(202).json({ ok: true });
  });
  app.use(errorHandlerMiddleware(silentLogger()));
  return app;
}

describe('keyRateLimitMiddleware', () => {
  it('limits per key, renders 429 RATE_LIMITED with Retry-After and reports the app', async () => {
    const { app, onLimited } = keyLimitedApp(2);
    expect((await request(app).get('/ingest')).status).toBe(202);
    const second = await request(app).get('/ingest');
    expect(second.status).toBe(202);
    expect(second.headers.ratelimit).toBeDefined();

    const limited = await request(app).get('/ingest');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe(ERROR_CODES.RATE_LIMITED);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(onLimited).toHaveBeenCalledWith('app-of-key-a', 'server');
  });

  it('keys are limited independently', async () => {
    const { app } = keyLimitedApp(1);
    expect((await request(app).get('/ingest').set(KEY_HEADER, 'key-a')).status).toBe(202);
    expect((await request(app).get('/ingest').set(KEY_HEADER, 'key-b')).status).toBe(202);
    expect((await request(app).get('/ingest').set(KEY_HEADER, 'key-a')).status).toBe(429);
  });
});

describe('ipFailureLimitMiddleware', () => {
  it('never limits successful (authenticated) traffic', async () => {
    const app = ipLimitedApp(2);
    for (let i = 0; i < 6; i += 1) {
      expect((await request(app).get('/ingest')).status).toBe(202);
    }
  });

  it('counts 401 and 403 responses and then blocks the client IP', async () => {
    const app = ipLimitedApp(2);
    expect((await request(app).get('/ingest').set(FAIL_HEADER, '401')).status).toBe(401);
    expect((await request(app).get('/ingest').set(FAIL_HEADER, '403')).status).toBe(403);
    const blocked = await request(app).get('/ingest');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe(ERROR_CODES.RATE_LIMITED);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('other failures (400, 500) are not counted', async () => {
    const app = ipLimitedApp(1);
    expect((await request(app).get('/ingest').set(FAIL_HEADER, '400')).status).toBe(400);
    expect((await request(app).get('/ingest').set(FAIL_HEADER, '500')).status).toBe(500);
    expect((await request(app).get('/ingest')).status).toBe(202);
  });
});

describe('clientIpKey', () => {
  it.each([
    [undefined, 'unknown'],
    ['203.0.113.9', '203.0.113.9'],
    ['::ffff:203.0.113.9', '203.0.113.9'],
    ['2001:db8:1:2:3:4:5:6', '2001:db8:1:2::/64'],
    ['2001:db8:1:2:ffff::1', '2001:db8:1:2::/64'],
  ])('%s → %s', (ip, expected) => {
    expect(clientIpKey(ip)).toBe(expected);
  });
});

describe('retryAfterSeconds', () => {
  it('rounds the remaining window up to whole seconds (≥ 1)', () => {
    const now = 1_000_000;
    const at = (ms: number) => ({ rateLimit: { resetTime: new Date(now + ms) } }) as unknown as Request;
    expect(retryAfterSeconds(at(30_100), now)).toBe(31);
    expect(retryAfterSeconds(at(-5), now)).toBe(1);
    expect(retryAfterSeconds({} as Request, now)).toBe(60);
  });
});
