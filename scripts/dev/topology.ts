/**
 * Ports, names and URLs of the LOCAL dev environment (`npm run dev`) — the one place they live.
 *
 * WHY: every module (docker, process start, launcher page, status checks, docs) needs the same
 * ports and URLs. Nexus API paths are built from `ROUTES` (packages/shared) — never hand-typed.
 *
 * @see ../../ai-context/09-local-development.md   the ports table
 */
import path from 'node:path';

import { PUBLIC_BASE_PATH, ROUTES, type RouteDescriptor } from '@nexus/shared';

/** Repo root (this file lives in scripts/dev). */
export const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** The git-ignored dev-only settings file (`.env.*` is in .gitignore and .dockerignore). */
export const DEV_ENV_FILE = path.join(REPO_ROOT, '.env.dev');

/**
 * Where Express mounts the route table.
 * @see ../../apps/api/src/app.ts   API_MOUNT_PATH (not imported: app.ts pulls in the whole api)
 */
export const API_MOUNT_PATH = '/api';

/** The dedicated dev Postgres container. NEVER the compose stack or the test containers (55432/55433). */
export const DEV_DB = {
  container: 'nexus-traffic-devdb',
  volume: 'nexus-traffic-devdata',
  image: 'postgres:18-alpine',
  /** PG18 image layout: the volume is mounted at /var/lib/postgresql (see ai-context/06-process.md). */
  dataMount: '/var/lib/postgresql',
  host: '127.0.0.1',
  hostPort: 55434,
  database: 'nexus_traffic_dev',
  superuser: 'postgres',
  /** Created by the migrate bootstrap in DB_APP_ROLE_MODE=separate (ADR 0002). */
  appRole: 'nexus_app',
} as const;

export const API_PORT = 4000;
export const WEB_PORT = 3305;
export const DEFAULT_LAUNCHER_PORT = 3399;
/** How many ports after the requested one the launcher tries when it is busy. */
export const LAUNCHER_PORT_ATTEMPTS = 20;

export const API_ORIGIN = `http://localhost:${API_PORT}`;
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
/** Base URL of the Nexus API (route paths from ROUTES are appended to it). */
export const API_BASE_URL = `${API_ORIGIN}${API_MOUNT_PATH}`;

/** Absolute API URL of a ROUTES descriptor (already filled with buildPath when it has params). */
export function apiUrl(routeOrPath: RouteDescriptor | string): string {
  const routePath = typeof routeOrPath === 'string' ? routeOrPath : routeOrPath.path;
  return `${API_BASE_URL}${routePath}`;
}

export function launcherOrigin(port: number): string {
  return `http://localhost:${port}`;
}

/** Every URL the summary box, the launcher page and the docs show. */
export const DEV_URLS = {
  dashboard: `${WEB_ORIGIN}${PUBLIC_BASE_PATH}/`,
  /** The dashboard's container healthcheck route (apps/web/src/app/healthz/route.ts). */
  webHealth: `${WEB_ORIGIN}${PUBLIC_BASE_PATH}/healthz`,
  apiHealth: apiUrl(ROUTES.health.live),
  apiReady: apiUrl(ROUTES.health.ready),
  guide: apiUrl(ROUTES.docs.home),
  openapi: apiUrl(ROUTES.docs.openapi),
} as const;

/** postgres:// URL for a login on the dev DB (the password is hex, so no URL escaping is needed). */
export function devDbUrl(user: string, password: string): string {
  return `postgres://${user}:${password}@${DEV_DB.host}:${DEV_DB.hostPort}/${DEV_DB.database}`;
}
