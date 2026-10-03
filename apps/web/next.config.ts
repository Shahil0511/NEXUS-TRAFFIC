/**
 * Next.js config of the dashboard.
 *
 * WHY THESE SETTINGS
 * - basePath = PUBLIC_BASE_PATH ('/traffic') in dev AND prod, so links, assets and the API prefix
 *   are identical everywhere (ADR 0001 "Public URLs"). Next prefixes <Link>, `_next` assets,
 *   rewrites and the proxy matcher with it automatically.
 * - output 'standalone' + outputFileTracingRoot/turbopack.root = repo root: the Docker image copies
 *   `.next/standalone` (which mirrors the monorepo layout → `apps/web/server.js`).
 * - transpilePackages: @nexus/shared and @nexus/auth are consumed as TypeScript source (the
 *   `@nexus/source` export condition), never from their dist.
 * - rewrites ONLY in development: `/traffic/api/*` and `/traffic/socket.io/` → the local api
 *   (Next proxies the websocket upgrade of an external rewrite too, and socket.io falls back to
 *   long-polling anyway). In production nginx routes `/traffic/api/` and `/traffic/socket.io/`
 *   straight to the api container (ops/nginx/nexus-traffic.conf) and never reaches this server.
 * - experimental.authInterrupts: src/app/no-access/page.tsx calls forbidden() so the no-access
 *   page is a real 403 (src/app/forbidden.tsx).
 *
 * @see ../../ops/nginx/local.conf
 * @see ./src/env.schema.ts   API_INTERNAL_URL
 */
import fs from 'node:fs';
import path from 'node:path';

import type { NextConfig } from 'next';

import { PUBLIC_BASE_PATH, SOCKET_PATH } from '@nexus/shared';

const REPO_ROOT = path.join(__dirname, '../..');
const IS_DEV = process.env.NODE_ENV !== 'production';
const DEFAULT_API_INTERNAL_URL = 'http://localhost:4000';

/**
 * WHY: `next dev` only reads .env files next to this config, but the project keeps ONE .env at the
 * repo root (shared with compose and the api). Existing variables win; production never reads it
 * (the container receives an explicit environment allowlist from docker-compose.yml).
 */
function loadRootEnvForDev(): void {
  const envFile = path.join(REPO_ROOT, '.env');
  if (IS_DEV && fs.existsSync(envFile)) process.loadEnvFile(envFile);
}

loadRootEnvForDev();

const nextConfig: NextConfig = {
  basePath: PUBLIC_BASE_PATH,
  output: 'standalone',
  outputFileTracingRoot: REPO_ROOT,
  turbopack: { root: REPO_ROOT },
  transpilePackages: ['@nexus/shared', '@nexus/auth'],
  poweredByHeader: false,
  skipTrailingSlashRedirect: true,
  reactStrictMode: true,
  // forbidden() → a real HTTP 403 for /no-access (Next ignores the status of a proxy rewrite).
  experimental: { authInterrupts: true },
  async rewrites() {
    if (!IS_DEV) return [];
    const target = process.env.API_INTERNAL_URL ?? DEFAULT_API_INTERNAL_URL;
    return [
      { source: '/api/:path*', destination: `${target}/api/:path*` },
      // socket.io always requests exactly `<path>/?EIO=4&…` (the query string is forwarded).
      { source: `${SOCKET_PATH}/`, destination: `${target}${SOCKET_PATH}/` },
    ];
  },
};

export default nextConfig;
