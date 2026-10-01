import { ERROR_CODES, INGEST_LIMITS } from '@nexus/shared';
import express, { type Express, type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { recordingLogger } from '../../../test/fixtures/recording-logger';
import { errorHandlerMiddleware } from './error-handler.middleware';
import { dashboardJsonBody, serverIngestJsonBody } from './json-body.middleware';

function buildApp(parser: RequestHandler): Express {
  const app = express();
  app.post('/probe', parser, (req, res) => {
    res.json({ body: req.body });
  });
  app.use(errorHandlerMiddleware(recordingLogger().logger));
  return app;
}

describe('serverIngestJsonBody', () => {
  const app = buildApp(serverIngestJsonBody());

  it('parses application/json', async () => {
    const res = await request(app)
      .post('/probe')
      .set('Content-Type', 'application/json; charset=utf-8')
      .send('{"a":1}');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ body: { a: 1 } });
  });

  it('415 UNSUPPORTED_MEDIA_TYPE for non-JSON content types', async () => {
    const res = await request(app).post('/probe').set('Content-Type', 'text/plain').send('{"a":1}');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe(ERROR_CODES.UNSUPPORTED_MEDIA_TYPE);
  });

  it('400 INVALID_ENVELOPE for malformed JSON', async () => {
    const res = await request(app)
      .post('/probe')
      .set('Content-Type', 'application/json')
      .send('{"a":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ERROR_CODES.INVALID_ENVELOPE);
  });

  it('413 PAYLOAD_TOO_LARGE above the server ingest limit', async () => {
    const big = JSON.stringify({ pad: 'x'.repeat(INGEST_LIMITS.server.maxBodyBytes) });
    const res = await request(app).post('/probe').set('Content-Type', 'application/json').send(big);
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe(ERROR_CODES.PAYLOAD_TOO_LARGE);
  });
});

describe('dashboardJsonBody', () => {
  const app = buildApp(dashboardJsonBody());

  it('parses JSON and leaves other content types unparsed', async () => {
    const ok = await request(app).post('/probe').send({ a: 1 });
    expect(ok.body).toEqual({ body: { a: 1 } });
    const text = await request(app).post('/probe').set('Content-Type', 'text/plain').send('hi');
    expect(text.status).toBe(200);
    expect(text.body.body).toBeUndefined();
  });

  it('400 BAD_REQUEST for malformed JSON', async () => {
    const res = await request(app)
      .post('/probe')
      .set('Content-Type', 'application/json')
      .send('{oops');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ERROR_CODES.BAD_REQUEST);
  });
});
