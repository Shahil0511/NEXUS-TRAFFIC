import { ERROR_CODES, INGEST_HEADERS } from '@nexus/shared';
import express, { type Express, type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { recordingLogger } from '../../../test/fixtures/recording-logger';
import type { Viewer } from '../../domain/viewer';
import { dashboardCsrfMiddleware, requireAdminMiddleware } from './dashboard-guards.middleware';
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
