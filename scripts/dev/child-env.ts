/**
 * The EXPLICIT environment of every child process (migrate, api, web).
 *
 * WHY EXPLICIT: the api/migrate (`dotenv`) and `next dev` (`process.loadEnvFile`) also read the root
 * `.env`, which belongs to the docker rehearsal / production. Neither overrides a variable that is
 * already set — even to an empty string — so setting EVERY key those apps read here guarantees the
 * root `.env` cannot leak into the dev environment (e.g. an owner-mode DATABASE_URL or an email
 * allowlist).
 *
 * @see ../../apps/api/src/config/env.schema.ts   the api keys (all of them are set below)
 * @see ../../apps/api/src/db/migrate-config.ts   the migrate keys
 * @see ../../apps/web/src/env.schema.ts          the web keys
 */
import path from 'node:path';

import { PUBLIC_BASE_PATH, SOCKET_PATH } from '@nexus/shared';

import type { DevEnvValues } from './env-file';
import { API_ORIGIN, API_PORT, DEV_DB, devDbUrl, REPO_ROOT, WEB_ORIGIN } from './topology';

export type EnvMap = Record<string, string>;

/** Always an admin of the dev dashboard (the launcher's default sign-in email). */
export const DEFAULT_ADMIN_EMAIL = 'admin@libas.in';
export const DEFAULT_VIEWER_EMAIL = 'viewer@libas.in';
export const DEV_ALLOWED_DOMAIN = 'libas.in';

/** admin@libas.in, plus the developer's git email when it is a company address. */
export function devAdminEmails(gitEmail: string | null): string[] {
  const emails = [DEFAULT_ADMIN_EMAIL];
  const normalized = gitEmail?.trim().toLowerCase();
  if (normalized && normalized.endsWith(`@${DEV_ALLOWED_DOMAIN}`) && !emails.includes(normalized)) {
    emails.push(normalized);
  }
  return emails;
}

export interface DevTopologyInput {
  launcherOrigin: string;
  adminEmails: string[];
}

function dashboardPolicy(input: DevTopologyInput): EnvMap {
  return {
    DASHBOARD_ALLOWED_EMAILS: '',
    DASHBOARD_ALLOWED_DOMAINS: DEV_ALLOWED_DOMAIN,
    DASHBOARD_ADMIN_EMAILS: input.adminEmails.join(','),
  };
}

/** The migrate CLI: owner login = the container superuser; the api role is created separately. */
export function migrateEnv(values: DevEnvValues): EnvMap {
  return {
    MIGRATION_DATABASE_URL: devDbUrl(DEV_DB.superuser, values.DEV_DB_PASSWORD),
    DB_APP_ROLE_MODE: 'separate',
    NEXUS_APP_DB_PASSWORD: values.NEXUS_APP_DB_PASSWORD,
    LOG_LEVEL: 'info',
  };
}

/** Every key of apiEnvSchema, with dev values. */
export function apiEnv(values: DevEnvValues, input: DevTopologyInput): EnvMap {
  return {
    NODE_ENV: 'development',
    PORT: String(API_PORT),
    LOG_LEVEL: 'info',
    DATABASE_URL: devDbUrl(DEV_DB.appRole, values.NEXUS_APP_DB_PASSWORD),
    PG_POOL_WRITE_MAX: '4',
    PG_POOL_QUERY_MAX: '6',
    LIBAS_JWT_SECRET: values.LIBAS_JWT_SECRET,
    PUBLIC_ORIGIN: WEB_ORIGIN,
    PUBLIC_BASE_PATH,
    ...dashboardPolicy(input),
    API_KEY_PEPPER: values.API_KEY_PEPPER,
    USER_KEY_SECRET: values.USER_KEY_SECRET,
    IP_HASH_SECRET: values.IP_HASH_SECRET,
    IP_STORAGE_MODE: 'full',
    RAW_RETENTION_MONTHS: '6',
    TRUST_PROXY_HOPS: '0',
    CORS_DEV_ORIGINS: [WEB_ORIGIN, input.launcherOrigin].join(','),
    INGEST_RATE_LIMIT_SERVER_PER_MIN: '600',
    INGEST_RATE_LIMIT_BROWSER_PER_MIN: '6000',
    INGEST_RATE_LIMIT_BROWSER_PER_SESSION_PER_MIN: '60',
    INGEST_IP_FAILURE_PER_MIN: '60',
    DOCS_CONTACT: 'local dev',
    DOCS_DIR: path.join(REPO_ROOT, 'docs', 'dist'),
  };
}

/** Every key of webEnvSchema (+ the build-time public socket path), with dev values. */
export function webEnv(values: DevEnvValues, input: DevTopologyInput): EnvMap {
  return {
    NODE_ENV: 'development',
    API_INTERNAL_URL: API_ORIGIN,
    LIBAS_JWT_SECRET: values.LIBAS_JWT_SECRET,
    // Signed-out dashboard visits land on the launcher, which mints a dev token and sends them back.
    PORTAL_LOGIN_URL: `${input.launcherOrigin}/`,
    PORTAL_RETURN_PARAM: 'return',
    PUBLIC_ORIGIN: WEB_ORIGIN,
    PUBLIC_BASE_PATH,
    ...dashboardPolicy(input),
    // Same public path as production; next.config.ts rewrites it to the api in dev.
    NEXT_PUBLIC_SOCKET_PATH: `${PUBLIC_BASE_PATH}${SOCKET_PATH}`,
    NEXT_TELEMETRY_DISABLED: '1',
  };
}

/** The OS environment (PATH, SystemRoot, …) with the explicit values on top. */
export function withBaseEnv(explicit: EnvMap): NodeJS.ProcessEnv {
  return { ...process.env, ...explicit };
}

/** For the summary: the dev DB owner URL with the password masked. */
export function describeDevDb(): string {
  return `postgres://${DEV_DB.superuser}:****@${DEV_DB.host}:${DEV_DB.hostPort}/${DEV_DB.database}`;
}
