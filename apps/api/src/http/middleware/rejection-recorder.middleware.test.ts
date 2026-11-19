import { ERROR_CODES, INGEST_HEADERS } from '@nexus/shared';
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { apiKeyRow, appRow, fake, FIXED_NOW, silentLogger } from '../../../test/ingest-fixtures';
import type { IngestRejectionIncrement } from '../../domain/inserts';
import { BadRequestError, ForbiddenError, UnauthorizedError } from '../../errors/app-error';
import { FixedClock } from '../../lib/clock';
import type { IngestRejectionRepository } from '../../repositories/ingest-rejection.repository';
import { errorHandlerMiddleware } from './error-handler.middleware';
import { rejectionRecorderMiddleware } from './rejection-recorder.middleware';

const APP = appRow();
const authenticated: RequestHandler = (_req, res, next) => {
  res.locals.ingest = { app: APP, key: apiKeyRow() };
  next();
};

function setup(source: 'server' | 'browser', fail: () => never, authenticate = true) {
  const increment = vi.fn(async (_appId: string, _rows: readonly IngestRejectionIncrement[], _at: Date) => undefined);
  const recorder = rejectionRecorderMiddleware(
    fake<IngestRejectionRepository>({ increment }),
    source,
    new FixedClock(FIXED_NOW),
    silentLogger(),
  );
  const app = express();
  const auth: RequestHandler = authenticate ? authenticated : (_req, _res, next) => next();
  app.post('/ingest', express.json(), auth, recorder, () => fail());
  app.post('/ok', express.json(), auth, recorder, (_req, res) => {
    res.status(202).json({ ok: true });
  });
  app.use(errorHandlerMiddleware(silentLogger()));
  return { app, increment };
}

/** `finish` fires after supertest resolves; wait for the listener. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('rejectionRecorderMiddleware', () => {
  it('server INVALID_ENVELOPE → one row with the normalised X-Nexus-SDK label and schema_path ""', async () => {
    const { app, increment } = setup('server', () => {
      throw new BadRequestError('Invalid envelope', ERROR_CODES.INVALID_ENVELOPE);
    });
    await request(app).post('/ingest').set(INGEST_HEADERS.sdk, '@nexus/express@1.1.0').send({});
    await settle();
    expect(increment).toHaveBeenCalledWith(
      APP.id,
      [{ source: 'server', sdk: '@nexus/express@1.1.0', code: 'INVALID_ENVELOPE', schemaPath: '', rejected: 1 }],
      FIXED_NOW,
    );
  });

  it('server without X-Nexus-SDK → the body sdk {name, version} (FastAPI client), still normalised', async () => {
    const { app, increment } = setup('server', () => {
      throw new BadRequestError('Invalid envelope', ERROR_CODES.INVALID_ENVELOPE);
    });
    await request(app).post('/ingest').send({ sdk: { name: 'nexus-fastapi', version: '1.1.0' }, events: 'x' });
    await request(app).post('/ingest').send({ sdk: { name: 'bad name!', version: '1.1.0' } });
    await settle();
    expect(increment.mock.calls.map((call) => call[1][0]?.sdk)).toEqual(['nexus-fastapi@1.1.0', '']);
  });

  it('a 300-char sdk header is stored as ""', async () => {
    const { app, increment } = setup('server', () => {
      throw new BadRequestError('Invalid envelope', ERROR_CODES.INVALID_ENVELOPE);
    });
    await request(app).post('/ingest').set(INGEST_HEADERS.sdk, 'x'.repeat(300)).send({});
    await settle();
    expect(increment.mock.calls[0]![1][0]?.sdk).toBe('');
  });

  it('browser ORIGIN_NOT_ALLOWED → sdk is ALWAYS "" (sender-chosen text never creates rows)', async () => {
    const { app, increment } = setup('browser', () => {
      throw new ForbiddenError('origin', ERROR_CODES.ORIGIN_NOT_ALLOWED);
    });
    await request(app)
      .post('/ingest')
      .send({ client: { sdk: '@nexus/react', version: '1.1.0' } });
    await settle();
    expect(increment.mock.calls[0]![1]).toEqual([
      { source: 'browser', sdk: '', code: 'ORIGIN_NOT_ALLOWED', schemaPath: '', rejected: 1 },
    ]);
  });

  it('records nothing for other codes, successes, or when the app is unknown', async () => {
    const auth = setup('server', () => {
      throw new UnauthorizedError('bad key', ERROR_CODES.INVALID_API_KEY);
    });
    await request(auth.app).post('/ingest').send({});
    await request(auth.app).post('/ok').send({});
    const anonymous = setup(
      'browser',
      () => {
        throw new BadRequestError('Invalid envelope', ERROR_CODES.INVALID_ENVELOPE);
      },
      false,
    );
    await request(anonymous.app).post('/ingest').send({});
    await settle();
    expect(auth.increment).not.toHaveBeenCalled();
    expect(anonymous.increment).not.toHaveBeenCalled();
  });

  it('a repository failure is swallowed (logged), the response is unaffected', async () => {
    const { app, increment } = setup('server', () => {
      throw new BadRequestError('Invalid envelope', ERROR_CODES.INVALID_ENVELOPE);
    });
    increment.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).post('/ingest').send({});
    await settle();
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ERROR_CODES.INVALID_ENVELOPE);
  });
});
