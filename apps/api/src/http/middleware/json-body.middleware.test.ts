import type { AddressInfo } from 'node:net';
import net from 'node:net';

import { ERROR_CODES, INGEST_LIMITS, serverIngestEnvelopeSchema } from '@nexus/shared';
import express, { type Express, type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { recordingLogger } from '../../../test/fixtures/recording-logger';
import { errorHandlerMiddleware } from './error-handler.middleware';
import { dashboardJsonBody, mediaTypeOf, serverIngestJsonBody } from './json-body.middleware';
import { validateBody } from './validate.middleware';

/**
 * Sends a POST with NO body framing at all (no Content-Length, no Transfer-Encoding) — what
 * `curl -X POST -H 'Content-Type: application/json' URL` sends. supertest always adds a length.
 */
async function rawPostWithoutBody(app: Express, path: string, contentType: string): Promise<string> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    return await new Promise<string>((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1', () => {
        socket.write(
          [`POST ${path} HTTP/1.1`, 'Host: 127.0.0.1', `Content-Type: ${contentType}`, 'Connection: close', '', ''].join(
            '\r\n',
          ),
        );
      });
      let response = '';
      socket.on('data', (chunk) => (response += chunk.toString('utf8')));
      socket.on('end', () => resolve(response));
      socket.on('error', reject);
    });
  } finally {
    server.close();
  }
}

function buildApp(parser: RequestHandler): Express {
  const app = express();
  app.post('/probe', parser, (req, res) => {
    res.json({ body: req.body ?? null });
  });
  // Same order as the real route: body parser → … → envelope validation (INVALID_ENVELOPE).
  app.post('/envelope', parser, validateBody(serverIngestEnvelopeSchema, ERROR_CODES.INVALID_ENVELOPE), (_req, res) => {
    res.json({ ok: true });
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

  it('415 when the Content-Type header is missing', async () => {
    const res = await request(app).post('/probe');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe(ERROR_CODES.UNSUPPORTED_MEDIA_TYPE);
  });

  it('415 for a non-JSON content type even with an empty body', async () => {
    const res = await request(app).post('/probe').set('Content-Type', 'text/plain');
    expect(res.status).toBe(415);
  });

  it('an EMPTY body with Content-Type application/json is not a 415 (no envelope inside)', async () => {
    const res = await request(app).post('/probe').set('Content-Type', 'application/json');
    expect(res.status).toBe(200);
    // body-parser yields {} (Content-Length: 0) or nothing (no length) — never an events array.
    expect([null, {}]).toContainEqual(res.body.body);
  });

  it('…and the envelope validation then answers 400 INVALID_ENVELOPE', async () => {
    const res = await request(app).post('/envelope').set('Content-Type', 'application/json');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ERROR_CODES.INVALID_ENVELOPE);
  });

  it('…also when the request has no Content-Length at all (req.is() would say "no body" → 415)', async () => {
    const response = await rawPostWithoutBody(app, '/envelope', 'application/json');
    expect(response).toMatch(/^HTTP\/1\.1 400 /);
    expect(response).toContain(ERROR_CODES.INVALID_ENVELOPE);
    const text = await rawPostWithoutBody(app, '/envelope', 'text/plain');
    expect(text).toMatch(/^HTTP\/1\.1 415 /);
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

describe('mediaTypeOf', () => {
  it.each([
    ['application/json', 'application/json'],
    ['Application/JSON; charset=utf-8', 'application/json'],
    ['text/plain;charset=UTF-8', 'text/plain'],
    [undefined, ''],
  ])('%j → %j', (header, expected) => {
    expect(mediaTypeOf(header)).toBe(expected);
  });
});

describe('dashboardJsonBody', () => {
  const app = buildApp(dashboardJsonBody());

  it('parses JSON and leaves other content types unparsed', async () => {
    const ok = await request(app).post('/probe').send({ a: 1 });
    expect(ok.body).toEqual({ body: { a: 1 } });
    const text = await request(app).post('/probe').set('Content-Type', 'text/plain').send('hi');
    expect(text.status).toBe(200);
    expect(text.body.body).toBeNull();
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
