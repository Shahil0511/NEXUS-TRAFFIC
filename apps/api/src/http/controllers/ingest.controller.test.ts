import {
  browserIngestEnvelopeSchema,
  ERROR_CODES,
  INGEST_CONTRACT_VERSION,
  INGEST_HEADERS,
  ROUTES,
  serverIngestEnvelopeSchema,
  type BrowserIngestEnvelope,
  type IngestResultDto,
  type ServerIngestEnvelope,
  type VerifyResponseDto,
} from '@nexus/shared';
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import {
  apiKeyRow,
  appRow,
  browserEvent,
  fake,
  FIXED_NOW,
  serverEvent,
  silentLogger,
} from '../../../test/ingest-fixtures';
import type { BrowserIngestContext, IngestContext } from '../../domain/viewer';
import { FixedClock } from '../../lib/clock';
import type { IngestOptions, IngestService } from '../../services/ingest.service';
import { errorHandlerMiddleware } from '../middleware/error-handler.middleware';
import { validateBody } from '../middleware/validate.middleware';
import { IngestController } from './ingest.controller';

const RESULT: IngestResultDto = { accepted: 1, duplicates: 0, rejected: [], warnings: [] };
const VERIFY: VerifyResponseDto = {
  app: { slug: 'ebo-sales', displayName: 'EBO Sales' },
  keyKind: 'secret',
  contractVersion: INGEST_CONTRACT_VERSION,
  serverTime: FIXED_NOW.toISOString(),
};

const authenticated: RequestHandler = (_req, res, next) => {
  res.locals.ingest = { app: appRow(), key: apiKeyRow() };
  next();
};

function setup(withAuth = true) {
  const ingestServerEvents = vi.fn(
    async (_envelope: ServerIngestEnvelope, _ctx: IngestContext, _options: IngestOptions) => RESULT,
  );
  const verify = vi.fn((_ctx: IngestContext) => VERIFY);
  const controller = new IngestController(fake<IngestService>({ ingestServerEvents, verify }), new FixedClock(FIXED_NOW));
  const auth = withAuth ? [authenticated] : [];
  const app = express();
  app.post(ROUTES.ingest.server.path, express.json(), ...auth, validateBody(serverIngestEnvelopeSchema, ERROR_CODES.INVALID_ENVELOPE), controller.server);
  app.get(ROUTES.ingest.verify.path, ...auth, controller.verify);
  app.use(errorHandlerMiddleware(silentLogger()));
  return { app, ingestServerEvents, verify };
}

const body = (extra: Partial<ServerIngestEnvelope> = {}) => ({
  sentAt: '2026-10-01T09:59:59.000Z',
  events: [serverEvent()],
  ...extra,
});

describe('IngestController.server', () => {
  it('returns 202 with the result and the contract header', async () => {
    const { app, ingestServerEvents } = setup();
    const res = await request(app).post(ROUTES.ingest.server.path).send(body());

    expect(res.status).toBe(202);
    expect(res.body).toEqual(RESULT);
    expect(res.headers[INGEST_HEADERS.contract.toLowerCase()]).toBe(String(INGEST_CONTRACT_VERSION));
    const [envelope, ctx, options] = ingestServerEvents.mock.calls[0]!;
    expect(envelope.events).toHaveLength(1);
    expect(ctx).toMatchObject({ app: appRow(), key: apiKeyRow(), receivedAt: FIXED_NOW, sdk: null });
    expect(options).toEqual({ dryRun: false });
  });

  it('passes dryRun only for ?dryRun=1', async () => {
    const { app, ingestServerEvents } = setup();
    await request(app).post(`${ROUTES.ingest.server.path}?dryRun=1`).send(body());
    await request(app).post(`${ROUTES.ingest.server.path}?dryRun=true`).send(body());
    expect(ingestServerEvents.mock.calls.map((call) => call[2])).toEqual([{ dryRun: true }, { dryRun: false }]);
  });

  it('prefers the X-Nexus-SDK header over the envelope sdk', async () => {
    const { app, ingestServerEvents } = setup();
    await request(app)
      .post(ROUTES.ingest.server.path)
      .set(INGEST_HEADERS.sdk, '@nexus/express@2.0.0')
      .send(body({ sdk: { name: '@nexus/fetch', version: '1.0.0' } }));
    await request(app)
      .post(ROUTES.ingest.server.path)
      .send(body({ sdk: { name: '@nexus/fetch', version: '1.0.0' } }));
    expect(ingestServerEvents.mock.calls.map((call) => call[1].sdk)).toEqual([
      '@nexus/express@2.0.0',
      '@nexus/fetch@1.0.0',
    ]);
  });

  it('rejects a malformed envelope before reaching the service', async () => {
    const { app, ingestServerEvents } = setup();
    const res = await request(app).post(ROUTES.ingest.server.path).send({ events: [] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ERROR_CODES.INVALID_ENVELOPE);
    expect(ingestServerEvents).not.toHaveBeenCalled();
  });

  it('fails loudly (500) when the auth middleware is missing from the route', async () => {
    const { app } = setup(false);
    const res = await request(app).post(ROUTES.ingest.server.path).send(body());
    expect(res.status).toBe(500);
  });
});

describe('IngestController.verify', () => {
  it('returns 200 with the verify body', async () => {
    const { app, verify } = setup();
    const res = await request(app).get(ROUTES.ingest.verify.path);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(VERIFY);
    expect(verify.mock.calls[0]?.[0]).toMatchObject({ receivedAt: FIXED_NOW, app: appRow() });
  });
});

describe('IngestController.browser', () => {
  function browserSetup() {
    const ingestBrowserEvents = vi.fn(async (_envelope: BrowserIngestEnvelope, _ctx: BrowserIngestContext) => RESULT);
    const controller = new IngestController(fake<IngestService>({ ingestBrowserEvents }), new FixedClock(FIXED_NOW));
    const app = express();
    app.set('trust proxy', 1);
    app.post(
      ROUTES.ingest.browser.path,
      express.json(),
      validateBody(browserIngestEnvelopeSchema, ERROR_CODES.INVALID_ENVELOPE),
      authenticated,
      controller.browser,
    );
    app.use(errorHandlerMiddleware(silentLogger()));
    return { app, ingestBrowserEvents };
  }

  it('returns 202 and hands the service the request IP, user agent, cookie and client sdk', async () => {
    const { app, ingestBrowserEvents } = browserSetup();
    const res = await request(app)
      .post(ROUTES.ingest.browser.path)
      .set('X-Forwarded-For', '49.36.1.1')
      .set('User-Agent', 'UA/1.0')
      .set('Cookie', 'access_token=jwt')
      .send({
        key: 'nx_pk_x',
        sentAt: '2026-10-01T09:59:59.000Z',
        sessionId: '33333333-3333-4333-8333-333333333333',
        client: { sdk: '@nexus/react', version: '1.0.0' },
        events: [browserEvent()],
      });

    expect(res.status).toBe(202);
    expect(res.body).toEqual(RESULT);
    expect(res.headers[INGEST_HEADERS.contract.toLowerCase()]).toBe(String(INGEST_CONTRACT_VERSION));
    const [envelope, ctx] = ingestBrowserEvents.mock.calls[0]!;
    expect(envelope.events).toHaveLength(1);
    expect(ctx).toMatchObject({
      receivedAt: FIXED_NOW,
      sdk: '@nexus/react@1.0.0',
      request: { ip: '49.36.1.1', userAgent: 'UA/1.0', cookieHeader: 'access_token=jwt' },
    });
  });
});
