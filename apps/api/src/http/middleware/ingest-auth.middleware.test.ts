import { ERROR_CODES, INGEST_HEADERS, type KeyKind } from '@nexus/shared';
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { apiKeyRow, appRow, fake, silentLogger } from '../../../test/ingest-fixtures';
import type { AppKeyAuthenticator } from '../../auth/app-key.authenticator';
import { UnauthorizedError } from '../../errors/app-error';
import { requireIngest } from '../request-accessors';
import { errorHandlerMiddleware } from './error-handler.middleware';
import { anyKeyAuthMiddleware, serverKeyAuthMiddleware } from './ingest-auth.middleware';

const AUTHENTICATED = { app: appRow(), key: apiKeyRow() };

function setup(middlewareFor: (a: AppKeyAuthenticator) => RequestHandler, fails = false) {
  const authenticate = vi.fn(async (raw: string | undefined, _expected: KeyKind | 'any', _sdk?: string | null) => {
    if (fails || !raw) throw new UnauthorizedError('Invalid API key', ERROR_CODES.INVALID_API_KEY);
    return AUTHENTICATED;
  });
  const app = express();
  app.get('/probe', middlewareFor(fake<AppKeyAuthenticator>({ authenticate })), (_req, res) => {
    res.json({ keyId: requireIngest(res).key.id });
  });
  app.use(errorHandlerMiddleware(silentLogger()));
  return { app, authenticate };
}

describe('ingest auth middleware', () => {
  it('serverKeyAuth requires a secret key and exposes the result to the handler', async () => {
    const { app, authenticate } = setup(serverKeyAuthMiddleware);
    const res = await request(app).get('/probe').set(INGEST_HEADERS.key, 'nx_sk_x').set(INGEST_HEADERS.sdk, 'sdk@1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ keyId: AUTHENTICATED.key.id });
    expect(authenticate).toHaveBeenCalledWith('nx_sk_x', 'secret', 'sdk@1');
  });

  it('anyKeyAuth accepts either kind', async () => {
    const { app, authenticate } = setup(anyKeyAuthMiddleware);
    await request(app).get('/probe').set(INGEST_HEADERS.key, 'nx_pk_x');
    expect(authenticate).toHaveBeenCalledWith('nx_pk_x', 'any', null);
  });

  it('renders authentication failures through the error envelope', async () => {
    const { app } = setup(serverKeyAuthMiddleware, true);
    const res = await request(app).get('/probe').set(INGEST_HEADERS.key, 'nx_sk_bad');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: ERROR_CODES.INVALID_API_KEY, message: 'Invalid API key' });
  });

  it('passes an absent header as undefined', async () => {
    const { app, authenticate } = setup(serverKeyAuthMiddleware);
    await request(app).get('/probe');
    expect(authenticate.mock.calls[0]?.[0]).toBeUndefined();
  });
});
