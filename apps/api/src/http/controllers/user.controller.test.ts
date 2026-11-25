import {
  buildPath,
  ERROR_CODES,
  ROUTES,
  userKeyParamsSchema,
  userDayQuerySchema,
  type UserDayDetailDto,
  type UserDayQuery,
} from '@nexus/shared';
import express, { type Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { recordingLogger } from '../../../test/fixtures/recording-logger';
import type { Viewer } from '../../domain/viewer';
import type { UserService } from '../../services/user.service';
import { DASHBOARD_ANALYTICS_CACHE } from '../cache-control';
import { errorHandlerMiddleware } from '../middleware/error-handler.middleware';
import { validateParams, validateQuery } from '../middleware/validate.middleware';
import { UserController } from './user.controller';

const ADMIN: Viewer = { email: 'boss@libas.in', isAdmin: true };
const USER_KEY = 'ab'.repeat(32);

class FakeUsers implements Pick<UserService, 'day'> {
  readonly calls: unknown[][] = [];

  async day(userKey: string, query: UserDayQuery, viewer: Viewer): Promise<UserDayDetailDto> {
    this.calls.push([userKey, query, viewer]);
    return {
      window: {
        from: '2026-11-19T18:30:00.000Z',
        to: '2026-11-20T18:30:00.000Z',
        grain: 'hour',
      },
      day: query.day,
      summary: null,
      timeInAppMs: 0,
      blocks: [],
      blockCount: 0,
      blocksTruncated: false,
      requestsOutsideBlocks: 0,
      pages: [],
      pagesTotal: 0,
      tools: [],
      toolsTotal: 0,
      visits: [],
    };
  }
}

/** Wired like the real route table: viewer → validateParams → validateQuery → controller. */
function buildApp(service: FakeUsers): Express {
  const ctl = new UserController(service as unknown as UserService);
  const app = express();
  app.use((_req, res, next) => {
    res.locals.viewer = ADMIN;
    next();
  });
  app.get(
    ROUTES.users.day.path,
    validateParams(userKeyParamsSchema),
    validateQuery(userDayQuerySchema),
    ctl.day,
  );
  app.use(errorHandlerMiddleware(recordingLogger().logger));
  return app;
}

const dayPath = buildPath(ROUTES.users.day, { userKey: USER_KEY });

describe('UserController.day', () => {
  it('→ 200 with the service DTO for the validated day, app, env and the viewer; private short cache', async () => {
    const service = new FakeUsers();
    const res = await request(buildApp(service)).get(
      `${dayPath}?day=2026-11-20&app=ebo-sales&env=staging&range=7d`,
    );
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe(DASHBOARD_ANALYTICS_CACHE);
    expect(DASHBOARD_ANALYTICS_CACHE).toBe('private, max-age=15');
    expect(res.body).toMatchObject({ day: '2026-11-20', summary: null });
    // The stray global range is stripped by the schema, not passed on.
    expect(service.calls).toEqual([
      [USER_KEY, { day: '2026-11-20', app: 'ebo-sales', env: 'staging' }, ADMIN],
    ]);
  });

  it('→ 400 without a valid day; the service is not called', async () => {
    const service = new FakeUsers();
    const app = buildApp(service);
    for (const query of ['', '?day=2026-11-31', '?day=20-11-2026']) {
      const res = await request(app).get(`${dayPath}${query}`);
      expect(res.status, query).toBe(400);
      expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    }
    expect(service.calls).toEqual([]);
  });
});
