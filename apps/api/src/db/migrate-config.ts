/**
 * Configuration of the `migrate` CLI — deliberately SEPARATE from the api config: the migrate
 * container connects as the database OWNER and needs none of the api's secrets, and the api must
 * never see the owner connection string.
 *
 * Fails with ONE line listing every missing/invalid key, and never echoes a value.
 */
import path from 'node:path';

import dotenv from 'dotenv';
import { z } from 'zod';

import { MIN_APP_PASSWORD_LENGTH } from './migration-runner/bootstrap';

export const migrateEnvSchema = z.object({
  /** postgres://<POSTGRES_USER>:<POSTGRES_PASSWORD>@postgres:5432/<POSTGRES_DB> (the owner). */
  MIGRATION_DATABASE_URL: z.string().url(),
  /** Password the bootstrap sets on role nexus_app; the api's DATABASE_URL must use the same. */
  NEXUS_APP_DB_PASSWORD: z
    .string()
    .min(MIN_APP_PASSWORD_LENGTH, `must be at least ${MIN_APP_PASSWORD_LENGTH} characters`),
  /** debug | info | warn | error */
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type MigrateConfig = Readonly<z.infer<typeof migrateEnvSchema>>;

export class MigrateConfigError extends Error {}

/** Validates `source` (process.env); the error lists keys and reasons only. */
export function parseMigrateConfig(source: NodeJS.ProcessEnv): MigrateConfig {
  const parsed = migrateEnvSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new MigrateConfigError(`Invalid migrate environment — ${problems}`);
  }
  return Object.freeze(parsed.data);
}

/** Reads `.env` (repo root, then apps/api) for local runs; containers get real env vars. */
export function loadMigrateConfig(): MigrateConfig {
  dotenv.config({ path: path.resolve(__dirname, '../../../../.env'), quiet: true });
  dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
  return parseMigrateConfig(process.env);
}
