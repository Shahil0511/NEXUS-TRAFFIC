/**
 * THE route table of the Data Nexus Traffic API.
 *
 * WHY THIS FILE EXISTS
 * It is the ONLY link across the HTTP boundary. The web client (`apps/web/src/lib/api.ts`), the
 * Express route table (`apps/api/src/http/routes/index.ts`), the OpenAPI emitter and the reference
 * SDKs all import these descriptors — so "Find All References" on e.g. `ROUTES.endpoints.list`
 * shows the caller AND the handler. NEVER hand-type an API path anywhere else.
 *
 * RULES
 * - Exactly two levels: `group.leaf → { method, path }`.
 * - Paths are relative to the API mount (`/api`), so `/v1/endpoints` is served at
 *   `/api/v1/endpoints` and publicly at `https://nexus.libas.in/traffic/api/v1/endpoints`.
 * - Every group lives under `/v1/<group>` except `health` and `docs`, which are unversioned.
 * - Controller method name === service method name === leaf name (see ai-context/05-conventions.md).
 *
 * ZERO dependencies: bundled into the reference SDKs.
 */

export type HttpVerb = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RouteDescriptor {
  readonly method: HttpVerb;
  readonly path: string;
}

export type RouteTable = Readonly<Record<string, Readonly<Record<string, RouteDescriptor>>>>;

export const ROUTES = {
  // ─── Unversioned ──────────────────────────────────────────────────────────
  health: {
    live: { method: 'GET', path: '/health' },
    ready: { method: 'GET', path: '/health/ready' },
  },
  docs: {
    /** The public integration guide (the link sent to other teams). Trailing slash on purpose. */
    home: { method: 'GET', path: '/docs/' },
    openapi: { method: 'GET', path: '/docs/openapi.json' },
    /** Snippets, examples and SDK tarballs. Express 5 named wildcard. */
    files: { method: 'GET', path: '/docs/files/*filePath' },
  },

  // ─── Public ingest contract (other teams) ─────────────────────────────────
  ingest: {
    server: { method: 'POST', path: '/v1/ingest/server' },
    browser: { method: 'POST', path: '/v1/ingest/browser' },
    verify: { method: 'GET', path: '/v1/ingest/verify' },
  },

  // ─── Dashboard (SSO) ──────────────────────────────────────────────────────
  me: {
    get: { method: 'GET', path: '/v1/me' },
  },
  apps: {
    list: { method: 'GET', path: '/v1/apps' },
    create: { method: 'POST', path: '/v1/apps' },
    update: { method: 'PATCH', path: '/v1/apps/:slug' },
    createKey: { method: 'POST', path: '/v1/apps/:slug/keys' },
    expireKey: { method: 'PATCH', path: '/v1/apps/:slug/keys/:keyId' },
    revokeKey: { method: 'DELETE', path: '/v1/apps/:slug/keys/:keyId' },
  },
  overview: {
    summary: { method: 'GET', path: '/v1/overview/summary' },
    timeseries: { method: 'GET', path: '/v1/overview/timeseries' },
    /** One row per registered app (traffic, errors, users) — the Applications page. */
    apps: { method: 'GET', path: '/v1/overview/apps' },
  },
  endpoints: {
    list: { method: 'GET', path: '/v1/endpoints' },
    detail: { method: 'GET', path: '/v1/endpoints/:endpointId' },
  },
  errors: {
    summary: { method: 'GET', path: '/v1/errors/summary' },
    list: { method: 'GET', path: '/v1/errors' },
  },
  users: {
    list: { method: 'GET', path: '/v1/users' },
    /** Daily active users over the window + WAU/MAU. Registered BEFORE `/:userKey`. */
    activity: { method: 'GET', path: '/v1/users/activity' },
    /**
     * Email search. POST on purpose: a typed email never travels in a URL, so it never reaches an
     * access log (ADR 0006). A read, not a mutation.
     */
    search: { method: 'POST', path: '/v1/users/search' },
    profile: { method: 'GET', path: '/v1/users/:userKey' },
    timeline: { method: 'GET', path: '/v1/users/:userKey/timeline' },
  },
  journeys: {
    sessions: { method: 'GET', path: '/v1/journeys/sessions' },
    session: { method: 'GET', path: '/v1/journeys/sessions/:app/:sessionId' },
    topPaths: { method: 'GET', path: '/v1/journeys/top-paths' },
  },
  pages: {
    list: { method: 'GET', path: '/v1/pages' },
    /** `pageId` = toPageId(app, pathTemplate): the template never appears in the URL. */
    detail: { method: 'GET', path: '/v1/pages/:app/:pageId' },
  },
  tools: {
    usage: { method: 'GET', path: '/v1/tools' },
    /** `toolId` = toToolId(app, tool): the tool name never appears in the URL. */
    detail: { method: 'GET', path: '/v1/tools/:app/:toolId' },
  },
  geo: {
    countries: { method: 'GET', path: '/v1/geo/countries' },
    cities: { method: 'GET', path: '/v1/geo/cities' },
  },
  live: {
    snapshot: { method: 'GET', path: '/v1/live/snapshot' },
  },
  integration: {
    health: { method: 'GET', path: '/v1/integration/health' },
  },
} as const satisfies RouteTable;

export type RouteGroup = keyof typeof ROUTES;

/** Names of the `:param` segments of a path, e.g. '/v1/apps/:slug/keys/:keyId' → 'slug' | 'keyId'. */
export type PathParamNames<P extends string> = P extends `${string}:${infer Param}/${infer Rest}`
  ? Param | PathParamNames<`/${Rest}`>
  : P extends `${string}:${infer Param}`
    ? Param
    : never;

export type PathParams<R extends RouteDescriptor> = [PathParamNames<R['path']>] extends [never]
  ? Record<string, never>
  : Record<PathParamNames<R['path']>, string>;

/**
 * Fill the `:param` segments of a route path. Values are URI-encoded.
 * Throws when a param is missing — a programming error, not user input.
 */
export function buildPath<R extends RouteDescriptor>(route: R, params?: PathParams<R>): string {
  const values = (params ?? {}) as Record<string, string | undefined>;
  return route.path.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
    const value = values[name];
    if (value === undefined || value === '') {
      throw new Error(`buildPath: missing param "${name}" for ${route.method} ${route.path}`);
    }
    return encodeURIComponent(value);
  });
}

/** Every leaf of the table, flattened — used by the route contract tests. */
export function listRoutes(): Array<{ group: string; leaf: string; route: RouteDescriptor }> {
  return Object.entries(ROUTES as RouteTable).flatMap(([group, leaves]) =>
    Object.entries(leaves).map(([leaf, route]) => ({ group, leaf, route })),
  );
}

/** `group.leaf` id of a ROUTES leaf, e.g. 'endpoints.detail' (a typo is a compile error). */
export type RouteLeafId = {
  [G in RouteGroup]: `${G}.${Extract<keyof (typeof ROUTES)[G], string>}`;
}[RouteGroup];

/**
 * Groups the dashboard never calls: probes, the public guide and the ingest contract (SDKs).
 * WHY: the web client coverage test (apps/web/src/lib/api.test.ts) skips them.
 */
export const NON_DASHBOARD_ROUTE_GROUPS = [
  'health',
  'docs',
  'ingest',
] as const satisfies readonly RouteGroup[];

/**
 * Leaves the API does NOT serve yet, with the step that adds them.
 *
 * WHY one shared list: two tests read it — the api route contract (every other leaf is
 * registered exactly once) and the web client coverage (every other dashboard leaf has an
 * `api.*` function, and a pending one has none). So the web client covers EXACTLY the routes
 * the API serves. A step that registers a leaf removes it here and adds its `api.*` function.
 *
 * @see ../../../apps/api/test/routes-contract.test.ts
 * @see ../../../apps/web/src/lib/api.test.ts
 */
export const PENDING_ROUTE_LEAVES: readonly RouteLeafId[] = []; // S5 registered the last one
