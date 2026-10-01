import { ERROR_CODES } from '@nexus/shared';
import express, { type Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { recordingLogger } from '../../../test/fixtures/recording-logger';
import { errorHandlerMiddleware } from './error-handler.middleware';
import { validateBody, validateParams, validateQuery } from './validate.middleware';

const querySchema = z.object({
  limit: z.coerce.number().int().max(100).default(25),
  q: z.string().optional(),
});
const paramsSchema = z.object({ id: z.coerce.number().int() });
const bodySchema = z.object({
  name: z.string().trim().min(1),
  tags: z.array(z.string()).default([]),
});

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.post(
    '/items/:id',
    validateParams(paramsSchema),
    validateQuery(querySchema),
    validateBody(bodySchema),
    (req, res) => {
      res.json({ validated: res.locals.validated, rawQueryLimit: req.query.limit ?? null });
    },
  );
  app.use(errorHandlerMiddleware(recordingLogger().logger));
  return app;
}

describe('validate middleware', () => {
  const app = buildApp();

  it('stores parsed values (defaults + coercions) in res.locals.validated, merging all parts', async () => {
    const res = await request(app).post('/items/7').send({ name: '  widget ' });
    expect(res.status).toBe(200);
    expect(res.body.validated).toEqual({
      params: { id: 7 },
      query: { limit: 25 },
      body: { name: 'widget', tags: [] },
    });
    expect(res.body.rawQueryLimit).toBeNull();
  });

  it('coerces query strings', async () => {
    const res = await request(app).post('/items/7?limit=10&q=x').send({ name: 'w' });
    expect(res.body.validated.query).toEqual({ limit: 10, q: 'x' });
  });

  it('400 VALIDATION_ERROR with per-field details', async () => {
    const res = await request(app).post('/items/7?limit=500').send({ name: 'w' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(res.body.error.message).toBe('Invalid request query');
    expect(res.body.error.details).toEqual([{ path: 'limit', message: expect.any(String) }]);
  });

  it('reports nested body paths joined with dots', async () => {
    const res = await request(app)
      .post('/items/7')
      .send({ name: '', tags: ['ok', 3] });
    expect(res.status).toBe(400);
    const paths = (res.body.error.details as Array<{ path: string }>).map((d) => d.path).sort();
    expect(paths).toEqual(['name', 'tags.1']);
  });
});
