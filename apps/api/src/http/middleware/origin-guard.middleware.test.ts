import { ERROR_CODES } from '@nexus/shared';
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { apiKeyRow, appRow, silentLogger } from '../../../test/ingest-fixtures';
import { errorHandlerMiddleware } from './error-handler.middleware';
import { isAllowedOrigin, originGuardMiddleware, requestOrigin } from './origin-guard.middleware';

const ALLOWED = 'https://ebo.libas.in';

describe('requestOrigin', () => {
  it.each([
    [ALLOWED, undefined, ALLOWED],
    [ALLOWED, 'https://evil.example/page', ALLOWED],
    ['null', `${ALLOWED}/page`, null],
    [undefined, `${ALLOWED}/ebo-sales/stores?x=1`, ALLOWED],
    ['', `${ALLOWED}/x`, ALLOWED],
    [undefined, 'not a url', null],
    [undefined, undefined, null],
  ])('Origin %j + Referer %j → %j', (origin, referer, expected) => {
    expect(requestOrigin(origin, referer)).toBe(expected);
  });
});

describe('isAllowedOrigin', () => {
  it('compares case-insensitively and ignores a trailing slash', () => {
    expect(isAllowedOrigin('https://EBO.libas.in', ['https://ebo.libas.in/'])).toBe(true);
    expect(isAllowedOrigin('https://ebo.libas.in:8443', [ALLOWED])).toBe(false);
    expect(isAllowedOrigin(null, [ALLOWED])).toBe(false);
  });
});

describe('originGuardMiddleware', () => {
  const authenticated: RequestHandler = (_req, res, next) => {
    res.locals.ingest = { app: appRow({ allowed_origins: [ALLOWED] }), key: apiKeyRow({ kind: 'publishable' }) };
    next();
  };
  const app = express();
  app.post('/beacon', authenticated, originGuardMiddleware(), (_req, res) => {
    res.status(202).json({ ok: true });
  });
  app.use(errorHandlerMiddleware(silentLogger()));

  it('passes an allowed Origin, or an allowed Referer when Origin is absent', async () => {
    expect((await request(app).post('/beacon').set('Origin', ALLOWED)).status).toBe(202);
    expect((await request(app).post('/beacon').set('Referer', `${ALLOWED}/ebo-sales`)).status).toBe(202);
  });

  it.each([
    ['a foreign Origin', { Origin: 'https://evil.example' }],
    ['Origin: null', { Origin: 'null', Referer: `${ALLOWED}/x` }],
    ['a foreign Origin with an allowed Referer', { Origin: 'https://evil.example', Referer: `${ALLOWED}/x` }],
    ['neither header', {}],
  ])('403 ORIGIN_NOT_ALLOWED for %s', async (_label, headers: Record<string, string>) => {
    const res = await request(app).post('/beacon').set(headers);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(ERROR_CODES.ORIGIN_NOT_ALLOWED);
  });
});
