/**
 * Load, validate and freeze the api configuration.
 *
 * WHY: fail fast at boot with ONE line listing every missing/invalid key, so the Team Lead can fix
 * `.env` from `docker compose logs api` without guessing. The frozen object is injected into the
 * container (never read process.env elsewhere).
 */
import path from 'node:path';

import { parseList, type DashboardAccessPolicy } from '@nexus/auth';
import dotenv from 'dotenv';

import { apiEnvSchema, type ApiEnv } from './env.schema';

export interface AppConfig {
  env: ApiEnv;
  isProduction: boolean;
  accessPolicy: DashboardAccessPolicy;
  corsDevOrigins: string[];
  docsDir: string;
}

export class ConfigError extends Error {}

export function parseConfig(source: NodeJS.ProcessEnv): AppConfig {
  const parsed = apiEnvSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ConfigError(`Invalid environment — ${problems}`);
  }
  const env = parsed.data;
  return Object.freeze({
    env,
    isProduction: env.NODE_ENV === 'production',
    accessPolicy: Object.freeze({
      allowedEmails: parseList(env.DASHBOARD_ALLOWED_EMAILS),
      allowedDomains: parseList(env.DASHBOARD_ALLOWED_DOMAINS),
      adminEmails: parseList(env.DASHBOARD_ADMIN_EMAILS),
    }),
    corsDevOrigins: parseList(env.CORS_DEV_ORIGINS),
    docsDir: env.DOCS_DIR ?? path.resolve(__dirname, '../../../../docs/dist'),
  });
}

/** Reads `.env` (apps/api, then repo root) for local dev; containers get real env vars. */
export function loadConfig(): AppConfig {
  // apps/api/.env FIRST: dotenv never overrides, so local dev values beat the root .env (compose).
  dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
  dotenv.config({ path: path.resolve(__dirname, '../../../../.env'), quiet: true });
  return parseConfig(process.env);
}
