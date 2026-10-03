import { browserIngestEnvelopeSchema, ERROR_CODES, INGEST_LIMITS } from '@nexus/shared';
import express, { type Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { recordingLogger } from '../../../test/fixtures/recording-logger';
import { beaconBodyMiddleware } from './beacon-body.middleware';
import { errorHandlerMiddleware } from './error-handler.middleware';
import { parseBeaconJsonMiddleware } from './parse-beacon-json.middleware';
import { validateBody } from './validate.middleware';

/** Same order as the real route: read text → parse JSON → (envelope validation). */
function buildApp(): Express {
  const app = express();
  app.post('/probe', beaconBodyMiddleware(), parseBeaconJsonMiddleware(), (req, res) => {
    res.json({ body: req.body ?? null });
  });
  app.post(
    '/envelope',
    beaconBodyMiddleware(),
    parseBeaconJsonMiddleware(),
    validateBody(browserIngestEnvelopeSchema, ERROR_CODES.INVALID_ENVELOPE),
    (_req, res) => {
      res.json({ ok: true });
    },
  );
  app.use(errorHandlerMiddleware(recordingLogger().logger));
  return app;
}

describe('beaconBody + parseBeaconJson', () => {
  const app = buildApp();

  it.each(['text/plain;charset=UTF-8', 'application/json'])('parses a JSON body sent as %s', async (type) => {
    const res = await request(app).post('/probe').set('Content-Type', type).send('{"a":1}');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ body: { a: 1 } });
  });

  it('415 UNSUPPORTED_MEDIA_TYPE for other content types (and a missing one)', async () => {
    const form = await request(app)
      .post('/probe')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('a=1');
    expect(form.status).toBe(415);
    expect(form.body.error.code).toBe(ERROR_CODES.UNSUPPORTED_MEDIA_TYPE);
    expect((await request(app).post('/probe')).status).toBe(415);
  });

  it('400 INVALID_ENVELOPE for malformed JSON, without echoing it', async () => {
    const res = await request(app).post('/probe').set('Content-Type', 'text/plain').send('{"key":"nx_pk_SECRET",');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ERROR_CODES.INVALID_ENVELOPE);
    expect(JSON.stringify(res.body)).not.toContain('nx_pk_SECRET');
  });

  it('an empty body reaches the envelope validation → 400 INVALID_ENVELOPE', async () => {
    const res = await request(app).post('/envelope').set('Content-Type', 'text/plain').send('');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ERROR_CODES.INVALID_ENVELOPE);
  });

  it('413 PAYLOAD_TOO_LARGE above the 60 KiB browser limit', async () => {
    const big = JSON.stringify({ pad: 'x'.repeat(INGEST_LIMITS.browser.maxBodyBytes) });
    const res = await request(app).post('/probe').set('Content-Type', 'text/plain').send(big);
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe(ERROR_CODES.PAYLOAD_TOO_LARGE);
  });
});
