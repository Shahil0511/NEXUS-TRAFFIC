import {
  buildPath,
  ERROR_CODES,
  ROUTES,
  userKeyParamsSchema,
  userDayQuerySchema,
  userListQuerySchema,
  userPatternQuerySchema,
  type CursorPage,
  type UserActivityPatternDto,
  type UserDayDetailDto,
  type UserDayQuery,
  type UserListQuery,
  type UserPatternQuery,
  type UserSummaryDto,
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

class FakeUsers implements Pick<UserService, 'list' | 'day' | 'pattern'> {
  readonly calls: unknown[][] = [];

  async list(query: UserListQuery): Promise<CursorPage<UserSummaryDto>> {
    this.calls.push([query]);
    return { items: [], nextCursor: null };
  }

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

  async pattern(
    userKey: string,
    query: UserPatternQuery,
    viewer: Viewer,
  ): Promise<UserActivityPatternDto> {
    this.calls.push([userKey, query, viewer]);
    return {
      window: { from: '2026-08-31T18:30:00.000Z', to: '2026-10-01T18:30:00.000Z', grain: 'day' },
      activeDays: 0,
      weekdayDays: [4, 5, 5, 5, 4, 4, 4],
      cells: [],
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
  app.get(ROUTES.users.list.path, validateQuery(userListQuerySchema), ctl.list);
  app.get(
    ROUTES.users.day.path,
    validateParams(userKeyParamsSchema),
    validateQuery(userDayQuerySchema),
    ctl.day,
  );
  app.get(
    ROUTES.users.pattern.path,
    validateParams(userKeyParamsSchema),
    validateQuery(userPatternQuerySchema),
    ctl.pattern,
  );
  app.use(errorHandlerMiddleware(recordingLogger().logger));
  return app;
}

describe('UserController.list', () => {
  it('→ 200 sorted by a time or a count key; an unknown key reaches the service as the default', async () => {
    const service = new FakeUsers();
    const app = buildApp(service);
    const first = await request(app).get(`${ROUTES.users.list.path}?sort=firstSeen&dir=asc`);
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toBe(DASHBOARD_ANALYTICS_CACHE);
    const byCount = await request(app).get(`${ROUTES.users.list.path}?sort=pageViews&dir=asc`);
    expect(byCount.status).toBe(200);
    const unknown = await request(app).get(`${ROUTES.users.list.path}?sort=nonsense&dir=asc`);
    expect(unknown.status).toBe(200);
    expect(service.calls).toEqual([
      [expect.objectContaining({ sort: 'firstSeen', dir: 'asc' })],
      [expect.objectContaining({ sort: 'pageViews', dir: 'asc' })],
      [expect.objectContaining({ sort: 'lastSeen', dir: 'asc' })],
    ]);
  });

  it.each(['requests', 'failed', 'sessions'] as const)(
    'passes the count sort %s through to the service (ADR 0018)',
    async (sort) => {
      const service = new FakeUsers();
      const res = await request(buildApp(service)).get(`${ROUTES.users.list.path}?sort=${sort}`);
      expect(res.status).toBe(200);
      expect(service.calls).toEqual([[expect.objectContaining({ sort, dir: 'desc' })]]);
    },
  );
});

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

const patternPath = buildPath(ROUTES.users.pattern, { userKey: USER_KEY });

describe('UserController.pattern', () => {
  it('→ 200 with the service DTO; the range defaults to 30d; private short cache', async () => {
    const service = new FakeUsers();
    const app = buildApp(service);
    const res = await request(app).get(`${patternPath}?app=ebo-sales&env=staging`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe(DASHBOARD_ANALYTICS_CACHE);
    expect(DASHBOARD_ANALYTICS_CACHE).toBe('private, max-age=15');
    expect(res.body).toMatchObject({ activeDays: 0, cells: [] });
    await request(app).get(`${patternPath}?range=7d`);
    expect(service.calls).toEqual([
      [USER_KEY, { app: 'ebo-sales', env: 'staging', range: '30d' }, ADMIN],
      [USER_KEY, { range: '7d' }, ADMIN],
    ]);
  });

  it('→ 400 for a range the grid does not offer; the service is not called', async () => {
    const service = new FakeUsers();
    const app = buildApp(service);
    for (const query of ['?range=90d', '?range=24h', '?range=custom']) {
      const res = await request(app).get(`${patternPath}${query}`);
      expect(res.status, query).toBe(400);
      expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    }
    expect(service.calls).toEqual([]);
  });
});
