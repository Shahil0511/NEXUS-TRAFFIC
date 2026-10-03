import { browserIngestEnvelopeSchema, ERROR_CODES, INGEST_HEADERS, type KeyKind } from '@nexus/shared';
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { apiKeyRow, appRow, fake, silentLogger } from '../../../test/ingest-fixtures';
import type { AppKeyAuthenticator } from '../../auth/app-key.authenticator';
import { ForbiddenError, UnauthorizedError } from '../../errors/app-error';
import { requireIngest } from '../request-accessors';
import { errorHandlerMiddleware } from './error-handler.middleware';
import { anyKeyAuthMiddleware, publishableKeyAuthMiddleware, serverKeyAuthMiddleware } from './ingest-auth.middleware';
import { validateBody } from './validate.middleware';

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

describe('publishableKeyAuthMiddleware', () => {
  const BROWSER_APP = appRow({ browser_ingest_enabled: true });
  const PUBLISHABLE = apiKeyRow({ kind: 'publishable' });

  function browserSetup(result: () => { app: ReturnType<typeof appRow>; key: ReturnType<typeof apiKeyRow> }) {
    const authenticate = vi.fn(async (_raw: string | undefined, _expected: KeyKind | 'any', _sdk?: string | null) =>
      result(),
    );
    const app = express();
    app.post(
      '/beacon',
      express.json(),
      validateBody(browserIngestEnvelopeSchema, ERROR_CODES.INVALID_ENVELOPE),
      publishableKeyAuthMiddleware(fake<AppKeyAuthenticator>({ authenticate })),
      (_req, res) => {
        res.json({ keyId: requireIngest(res).key.id });
      },
    );
    app.use(errorHandlerMiddleware(silentLogger()));
    return { app, authenticate };
  }

  const envelope = (extra: Record<string, unknown> = {}) => ({
    key: 'nx_pk_body',
    sentAt: '2026-10-01T09:59:59.000Z',
    sessionId: '33333333-3333-4333-8333-333333333333',
    events: [{}],
    ...extra,
  });

  it('reads the key from the BODY, requires a publishable key and records the client sdk', async () => {
    const { app, authenticate } = browserSetup(() => ({ app: BROWSER_APP, key: PUBLISHABLE }));
    const res = await request(app)
      .post('/beacon')
      .set(INGEST_HEADERS.key, 'nx_sk_header_is_ignored')
      .send(envelope({ client: { sdk: '@nexus/react', version: '1.0.0' } }));
    expect(res.status).toBe(200);
    expect(authenticate).toHaveBeenCalledWith('nx_pk_body', 'publishable', '@nexus/react@1.0.0');
  });

  it('403 BROWSER_INGEST_DISABLED when the app has browser ingest off', async () => {
    const { app } = browserSetup(() => ({ app: appRow({ browser_ingest_enabled: false }), key: PUBLISHABLE }));
    const res = await request(app).post('/beacon').send(envelope());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(ERROR_CODES.BROWSER_INGEST_DISABLED);
  });

  it('renders the authenticator verdict (e.g. SECRET_KEY_EXPOSED) through the error envelope', async () => {
    const { app } = browserSetup(() => {
      throw new ForbiddenError('A secret key was sent to a browser endpoint', ERROR_CODES.SECRET_KEY_EXPOSED);
    });
    const res = await request(app).post('/beacon').send(envelope({ key: 'nx_sk_oops' }));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(ERROR_CODES.SECRET_KEY_EXPOSED);
    expect(JSON.stringify(res.body)).not.toContain('nx_sk_oops');
  });
});
