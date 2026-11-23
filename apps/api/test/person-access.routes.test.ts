/**
 * Person-level leaves are ADMIN-ONLY (no database): the real route table, the real CSRF and
 * requireAdmin guards and the real error handler, with a stand-in SSO step that signs the request
 * in as an admin or a plain viewer, and controllers that answer 200.
 *
 * WHY: proves per leaf that a non-admin gets the shared 403 error envelope BEFORE any controller
 * runs (so nothing about the person is read, and nothing is access-logged), that an admin gets
 * through, and that the lists of people stay open to every viewer.
 * @see ../src/http/routes/index.ts
 */
import {
  buildPath,
  ERROR_CODES,
  INGEST_HEADERS,
  PERSON_FILTERED_ROUTE_LEAVES,
  PERSON_ROUTE_LEAVES,
  ROUTES,
  type RouteDescriptor,
} from '@nexus/shared';
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { API_MOUNT_PATH, createApp } from '../src/app';
import type { Container } from '../src/container';
import type { Viewer } from '../src/domain/viewer';
import {
  dashboardCsrfMiddleware,
  requireAdminForUserKeyMiddleware,
  requireAdminMiddleware,
} from '../src/http/middleware/dashboard-guards.middleware';
import { silentLogger } from './ingest-fixtures';

const USER_KEY = 'ab'.repeat(32);
const VIEWER_HEADER = 'x-test-viewer';
const VIEWERS: Record<string, Viewer> = {
  admin: { email: 'boss@libas.in', isAdmin: true },
  viewer: { email: 'viewer@libas.in', isAdmin: false },
};

/** Stand-in for ssoAuth: the test picks who is signed in. */
const fakeSsoAuth: RequestHandler = (req, res, next) => {
  res.locals.viewer = VIEWERS[req.get(VIEWER_HEADER) ?? 'viewer'];
  next();
};
const passThrough: RequestHandler = (_req, _res, next) => next();

/** Every controller answers 200 with its own `group.leaf`, so a test sees which one ran. */
function controllerTable(): Container['controllers'] {
  return new Proxy({} as Container['controllers'], {
    get: (_target, group: string) =>
      new Proxy(
        {},
        {
          get:
            (_inner, leaf: string): RequestHandler =>
            (_req, res) => {
              res.json({ ran: `${group}.${leaf}` });
            },
        },
      ),
  });
}

function buildApp() {
  const middleware: Record<string, RequestHandler> = {
    ssoAuth: fakeSsoAuth,
    dashboardCsrf: dashboardCsrfMiddleware(),
    requireAdmin: requireAdminMiddleware(),
    requireAdminForUserKey: requireAdminForUserKeyMiddleware(),
    dashboardJsonBody: express.json(),
  };
  const container = {
    config: { env: { TRUST_PROXY_HOPS: 1 }, isProduction: true, corsDevOrigins: [] },
    logger: silentLogger(),
    controllers: controllerTable(),
    middleware: new Proxy(middleware, { get: (table, key: string) => table[key] ?? passThrough }),
  } as unknown as Container;
  return createApp(container);
}

const app = buildApp();

function send(route: RouteDescriptor, who: keyof typeof VIEWERS, path = route.path) {
  const target = `${API_MOUNT_PATH}${path}`;
  const call = route.method === 'POST' ? request(app).post(target) : request(app).get(target);
  return call.set(INGEST_HEADERS.dashboard, '1').set(VIEWER_HEADER, who);
}

const personLeaves = PERSON_ROUTE_LEAVES.map((id) => {
  const leaf = id.split('.')[1] as keyof typeof ROUTES.users;
  const route = ROUTES.users[leaf];
  return { id, route, path: buildPath(route, { userKey: USER_KEY } as never) };
});

describe('person-level leaves are admin-only', () => {
  it('covers profile, timeline, devices and daily', () => {
    expect(personLeaves.map((leaf) => leaf.id)).toEqual([
      'users.profile',
      'users.timeline',
      'users.devices',
      'users.daily',
    ]);
  });

  it.each(personLeaves.map((leaf) => [leaf.id, leaf] as const))(
    '%s: a non-admin gets 403 FORBIDDEN (the error envelope), the controller never runs',
    async (_id, leaf) => {
      const res = await send(leaf.route, 'viewer', leaf.path);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        error: { code: ERROR_CODES.FORBIDDEN, message: expect.any(String) },
      });
      expect(res.body).not.toHaveProperty('ran');
    },
  );

  it.each(personLeaves.map((leaf) => [leaf.id, leaf] as const))(
    '%s: an admin gets 200 from the same-named controller',
    async (id, leaf) => {
      const res = await send(leaf.route, 'admin', leaf.path);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ran: id });
    },
  );

  it('the CSRF header is still checked first (403 CSRF_HEADER_MISSING, even for an admin)', async () => {
    const [first] = personLeaves;
    const res = await request(app)
      .get(`${API_MOUNT_PATH}${first?.path ?? ''}`)
      .set(VIEWER_HEADER, 'admin');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: ERROR_CODES.CSRF_HEADER_MISSING } });
  });
});

const filteredLeaves = PERSON_FILTERED_ROUTE_LEAVES.map((id) => {
  const [group, leaf] = id.split('.') as [string, string];
  const route = (ROUTES as unknown as Record<string, Record<string, RouteDescriptor>>)[group]?.[
    leaf
  ] as RouteDescriptor;
  return { id, route };
});

describe('open lists narrowed to one person by ?userKey= are admin-only', () => {
  it('covers the sessions list, the failure summary and list, and online now', () => {
    expect(filteredLeaves.map((leaf) => leaf.id)).toEqual([
      'journeys.sessions',
      'errors.summary',
      'errors.list',
      'live.online',
    ]);
  });

  it.each(filteredLeaves.map((leaf) => [leaf.id, leaf] as const))(
    '%s: 200 for a non-admin without ?userKey=, 403 FORBIDDEN with it; an admin gets through',
    async (id, leaf) => {
      const open = await send(leaf.route, 'viewer');
      expect(open.status).toBe(200);
      expect(open.body).toEqual({ ran: id });

      const narrowed = `${leaf.route.path}?userKey=${USER_KEY}`;
      const refused = await send(leaf.route, 'viewer', narrowed);
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({ error: { code: ERROR_CODES.FORBIDDEN } });
      expect(refused.body).not.toHaveProperty('ran');

      const admin = await send(leaf.route, 'admin', narrowed);
      expect(admin.status).toBe(200);
      expect(admin.body).toEqual({ ran: id });
    },
  );
});

describe('the access log is admin-only, the lists of people are not', () => {
  it('privacy.accessLog: 403 for a non-admin, 200 for an admin', async () => {
    expect((await send(ROUTES.privacy.accessLog, 'viewer')).status).toBe(403);
    const res = await send(ROUTES.privacy.accessLog, 'admin');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ran: 'privacy.accessLog' });
  });

  it.each([
    ['users.list', ROUTES.users.list],
    ['users.activity', ROUTES.users.activity],
  ] as const)('%s: 200 for a non-admin', async (id, route) => {
    const res = await send(route, 'viewer');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ran: id });
  });

  it('users.search: 200 for a non-admin', async () => {
    const res = await send(ROUTES.users.search, 'viewer').send({ search: 'some' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ran: 'users.search' });
  });
});
