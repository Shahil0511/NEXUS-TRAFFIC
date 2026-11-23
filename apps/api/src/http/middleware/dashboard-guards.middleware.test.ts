import { ERROR_CODES, INGEST_HEADERS } from '@nexus/shared';
import express, { type Express, type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { recordingLogger } from '../../../test/fixtures/recording-logger';
import type { Viewer } from '../../domain/viewer';
import {
  dashboardCsrfMiddleware,
  requireAdminForUserKeyMiddleware,
  requireAdminMiddleware,
} from './dashboard-guards.middleware';
import { errorHandlerMiddleware } from './error-handler.middleware';

function withViewer(viewer: Viewer | undefined): RequestHandler {
  return (_req, res, next) => {
    if (viewer) res.locals.viewer = viewer;
    next();
  };
}

function buildApp(guard: RequestHandler, viewer?: Viewer): Express {
  const app = express();
  app.get('/probe', withViewer(viewer), guard, (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandlerMiddleware(recordingLogger().logger));
  return app;
}

describe('dashboardCsrfMiddleware', () => {
  const app = buildApp(dashboardCsrfMiddleware());

  it('passes with X-Nexus-Dashboard: 1', async () => {
    const res = await request(app).get('/probe').set(INGEST_HEADERS.dashboard, '1');
    expect(res.status).toBe(200);
  });

  it('403 CSRF_HEADER_MISSING without the header or with another value', async () => {
    for (const value of [undefined, '0', 'true']) {
      const req = request(app).get('/probe');
      const res = await (value === undefined ? req : req.set(INGEST_HEADERS.dashboard, value));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(ERROR_CODES.CSRF_HEADER_MISSING);
    }
  });
});

describe('requireAdminMiddleware', () => {
  it('passes admins', async () => {
    const res = await request(
      buildApp(requireAdminMiddleware(), { email: 'a@libas.in', isAdmin: true }),
    ).get('/probe');
    expect(res.status).toBe(200);
  });

  it('403 FORBIDDEN for non-admins', async () => {
    const res = await request(
      buildApp(requireAdminMiddleware(), { email: 'a@libas.in', isAdmin: false }),
    ).get('/probe');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(ERROR_CODES.FORBIDDEN);
  });

  it('500 (programming error) when ssoAuth is missing from the route', async () => {
    const res = await request(buildApp(requireAdminMiddleware())).get('/probe');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
  });
});

describe('requireAdminForUserKeyMiddleware', () => {
  const withQuery =
    (query: Record<string, unknown>): RequestHandler =>
    (_req, res, next) => {
      res.locals.validated = { query };
      next();
    };
  const viewer: Viewer = { email: 'v@libas.in', isAdmin: false };
  const admin: Viewer = { email: 'a@libas.in', isAdmin: true };
  const guarded = (query: Record<string, unknown>, who: Viewer = viewer) =>
    express()
      .get(
        '/probe',
        withViewer(who),
        withQuery(query),
        requireAdminForUserKeyMiddleware(),
        (_req, res) => {
          res.json({ ok: true });
        },
      )
      .use(errorHandlerMiddleware(recordingLogger().logger));

  it('lets every viewer read the list when it is not narrowed to one person', async () => {
    expect((await request(guarded({ range: '24h' })).get('/probe')).status).toBe(200);
  });

  it('403 FORBIDDEN for a viewer once ?userKey= narrows it to one person; admins pass', async () => {
    const res = await request(guarded({ userKey: 'ab'.repeat(32) })).get('/probe');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(ERROR_CODES.FORBIDDEN);
    const ok = await request(guarded({ userKey: 'ab'.repeat(32) }, admin)).get('/probe');
    expect(ok.status).toBe(200);
  });
});
