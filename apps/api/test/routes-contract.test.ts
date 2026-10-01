/**
 * Route contract: ROUTES (packages/shared/src/routes.ts) ↔ the Express route table
 * (src/http/routes/index.ts).
 *
 * WHY: ROUTES is the only link across HTTP. This test fails if a leaf that a step claims to have
 * built is not registered (or is registered twice, or with the wrong verb, or not wired to the
 * controller method of the same name), and EXPECTED_PENDING documents, leaf by leaf, what later
 * steps still have to add. When a step registers a leaf, it MUST remove it from EXPECTED_PENDING.
 */
import { listRoutes, type RouteDescriptor } from '@nexus/shared';
import type { RequestHandler, Router } from 'express';
import { describe, expect, it } from 'vitest';

import { API_MOUNT_PATH, createApp } from '../src/app';
import type { Container } from '../src/container';
import { buildRouter } from '../src/http/routes';
import { silentLogger } from './ingest-fixtures';

/** `group.leaf` of every ROUTES leaf that is deliberately NOT registered yet, with its step. */
const EXPECTED_PENDING = [
  // S2: dashboard Overview / API Routes / Errors
  'overview.summary',
  'overview.timeseries',
  'endpoints.list',
  'endpoints.detail',
  'errors.summary',
  'errors.list',
  // S3: browser ingest + Users / Journeys / Pages & Tools / Geography
  'ingest.browser',
  'users.list',
  'users.profile',
  'users.timeline',
  'journeys.sessions',
  'journeys.session',
  'journeys.topPaths',
  'pages.list',
  'tools.usage',
  'geo.countries',
  'geo.cities',
  // S4: live page
  'live.snapshot',
  // S5: Integration Health
  'integration.health',
] as const;

// ─── Fake container: every handler is a stable, named function ─────────────

type HandlerTable = Record<string, Record<string, RequestHandler>>;

/** `table[group][leaf]` returns the same function on every read, so identity can be asserted. */
function handlerTable(): HandlerTable {
  const groups = new Map<string, Record<string, RequestHandler>>();
  const groupOf = (group: string) => {
    const leaves = new Map<string, RequestHandler>();
    return new Proxy({} as Record<string, RequestHandler>, {
      get: (_target, leaf: string) => {
        if (!leaves.has(leaf)) leaves.set(leaf, namedHandler(`${group}.${leaf}`));
        return leaves.get(leaf);
      },
    });
  };
  return new Proxy({} as HandlerTable, {
    get: (_target, group: string) => {
      if (!groups.has(group)) groups.set(group, groupOf(group));
      return groups.get(group);
    },
  });
}

function namedHandler(name: string): RequestHandler {
  const handler: RequestHandler = (_req, _res, next) => next();
  Object.defineProperty(handler, 'name', { value: name });
  return handler;
}

/** Same handler for every middleware key — the route table only needs callables. */
function middlewareTable(): Record<string, RequestHandler> {
  const shared = namedHandler('middleware');
  return new Proxy({} as Record<string, RequestHandler>, { get: () => shared });
}

function fakeContainer(): { container: Container; controllers: HandlerTable } {
  const controllers = handlerTable();
  const container = {
    config: { env: { TRUST_PROXY_HOPS: 1 }, isProduction: true, corsDevOrigins: [] },
    logger: silentLogger(),
    controllers,
    middleware: middlewareTable(),
  } as unknown as Container;
  return { container, controllers };
}

// ─── Router stack inspection (router@2, used by Express 5) ──────────────────

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> };
}

interface Registration {
  path: string;
  method: string;
  handlers: unknown[];
}

function registrations(router: Router): Registration[] {
  return (router.stack as RouteLayer[]).flatMap((layer) => {
    const route = layer.route;
    if (!route) return [];
    return Object.keys(route.methods).map((method) => ({
      path: route.path,
      method: method.toUpperCase(),
      handlers: route.stack.map((l) => l.handle),
    }));
  });
}

const sameRoute = (reg: Registration, route: RouteDescriptor) =>
  reg.path === route.path && reg.method === route.method;

// ─── The contract ───────────────────────────────────────────────────────────

describe('ROUTES ↔ buildRouter', () => {
  const { container, controllers } = fakeContainer();
  const router = buildRouter(container);
  const regs = registrations(router);
  const pending = new Set<string>(EXPECTED_PENDING);
  const leaves = listRoutes().map((entry) => ({ ...entry, id: `${entry.group}.${entry.leaf}` }));
  const implemented = leaves.filter((leaf) => !pending.has(leaf.id));

  it('EXPECTED_PENDING names only real ROUTES leaves', () => {
    const known = new Set(leaves.map((leaf) => leaf.id));
    expect(EXPECTED_PENDING.filter((id) => !known.has(id))).toEqual([]);
  });

  it.each(implemented.map((leaf) => [leaf.id, leaf] as const))(
    '%s is registered exactly once and ends in controllers.<group>.<leaf>',
    (_id, leaf) => {
      const matches = regs.filter((reg) => sameRoute(reg, leaf.route));
      expect(matches).toHaveLength(1);
      const handlers = matches[0]?.handlers ?? [];
      expect(handlers.at(-1)).toBe(controllers[leaf.group]?.[leaf.leaf]);
    },
  );

  it.each(EXPECTED_PENDING.map((id) => [id] as const))(
    '%s is still pending (not registered)',
    (id) => {
      const leaf = leaves.find((l) => l.id === id);
      expect(regs.filter((reg) => leaf && sameRoute(reg, leaf.route))).toEqual([]);
    },
  );

  it('registers nothing that is not a ROUTES leaf', () => {
    const strays = regs.filter((reg) => !leaves.some((leaf) => sameRoute(reg, leaf.route)));
    expect(strays.map((reg) => `${reg.method} ${reg.path}`)).toEqual([]);
  });
});

describe('createApp mounts the route table', () => {
  interface MountLayer {
    handle: { stack?: unknown };
    match(path: string): boolean;
  }

  it(`under ${API_MOUNT_PATH} only`, () => {
    const { container } = fakeContainer();
    const app = createApp(container);
    const routerLayers = (app.router.stack as unknown as MountLayer[]).filter((layer) =>
      Array.isArray(layer.handle.stack),
    );
    expect(routerLayers).toHaveLength(1);
    const mounted = routerLayers[0];
    expect(mounted?.match(`${API_MOUNT_PATH}/v1/apps`)).toBe(true);
    expect(mounted?.match('/v1/apps')).toBe(false);
  });
});
