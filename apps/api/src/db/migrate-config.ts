/**
 * Configuration of the `migrate` CLI — deliberately SEPARATE from the api config: the migrate
 * container connects as the database OWNER and needs none of the api's secrets.
 *
 * DB_APP_ROLE_MODE (ADR 0002):
 * - 'separate' (default; local Docker Postgres, `--profile localdb`): migrate creates role nexus_app
 *   with NEXUS_APP_DB_PASSWORD (required, ≥ 16 chars) and grants it DML only; the api's
 *   DATABASE_URL is postgres://nexus_app:<that password>@…, so the api CONNECTS as nexus_app (note:
 *   compose still hands the api the whole .env via env_file, owner URL included).
 * - 'owner' (production on the shared server 10.150.0.5, database nexus_traffic, whose login has no
 *   CREATEROLE): no role is created or altered and NEXUS_APP_DB_PASSWORD is ignored. The api's
 *   DATABASE_URL MUST use the SAME login as MIGRATION_DATABASE_URL (scripts/preflight.sh checks the
 *   two are identical).
 *
 * Fails with ONE line listing every missing/invalid key, and never echoes a value.
 */
import path from 'node:path';

import dotenv from 'dotenv';
import { z } from 'zod';

import { APP_ROLE_MODE_VALUES, MIN_APP_PASSWORD_LENGTH, type AppRole } from './migration-runner/bootstrap';

export const migrateEnvSchema = z
  .object({
    /**
     * The owner login. Local: postgres://<POSTGRES_USER>:<POSTGRES_PASSWORD>@postgres:5432/<POSTGRES_DB>.
     * Shared server: postgres://<login>:<url-encoded password>@10.150.0.5:5432/nexus_traffic.
     */
    MIGRATION_DATABASE_URL: z.string().url(),
    /** separate | owner — see the header. */
    DB_APP_ROLE_MODE: z.enum(APP_ROLE_MODE_VALUES).default('separate'),
    /** 'separate' only: password the bootstrap sets on role nexus_app (the api's DATABASE_URL uses it). */
    NEXUS_APP_DB_PASSWORD: z.string().optional(),
    /** debug | info | warn | error */
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  })
  .superRefine(
    (env, ctx) => {
      const mode = env.DB_APP_ROLE_MODE ?? 'separate';
      const password = env.NEXUS_APP_DB_PASSWORD;
      if (mode === 'separate' && (typeof password !== 'string' || password.length < MIN_APP_PASSWORD_LENGTH)) {
        ctx.addIssue({
          code: 'custom',
          path: ['NEXUS_APP_DB_PASSWORD'],
          message: `required when DB_APP_ROLE_MODE=separate, at least ${MIN_APP_PASSWORD_LENGTH} characters`,
        });
      }
    },
    // WHY: run even when another key is invalid, so ONE error line lists every problem.
    { when: () => true },
  );

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

/** The bootstrap/runner view of DB_APP_ROLE_MODE (the password exists only in 'separate' mode). */
export function appRoleOf(config: MigrateConfig): AppRole {
  if (config.DB_APP_ROLE_MODE === 'owner') return { mode: 'owner' };
  // parseMigrateConfig guarantees the password in 'separate' mode.
  return { mode: 'separate', password: config.NEXUS_APP_DB_PASSWORD ?? '' };
}

/** Reads `.env` (apps/api, then repo root) for local runs; containers get real env vars. */
export function loadMigrateConfig(): MigrateConfig {
  // apps/api/.env FIRST: dotenv never overrides, so local dev values beat the root .env (compose).
  dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
  dotenv.config({ path: path.resolve(__dirname, '../../../../.env'), quiet: true });
  return parseMigrateConfig(process.env);
}
