/**
 * Idempotent database bootstrap, run by `migrate` as the owner (the MIGRATION_DATABASE_URL login)
 * on EVERY run, before any migration:
 *   1. CREATE SCHEMA IF NOT EXISTS traffic
 *   2. ('separate' mode only) create the runtime role nexus_app (LOGIN) if it is missing
 *   3. ('separate' mode only) set its password from NEXUS_APP_DB_PASSWORD (so rotating the env var
 *      + re-running migrate rotates the password)
 *   4. create the ledger table traffic.schema_migrations
 *
 * DB_APP_ROLE_MODE (ADR 0002):
 * - 'separate' (local Docker Postgres, `--profile localdb`): the api runs as nexus_app, DML only;
 *   its grants are re-applied after the migrations by ./grants.ts.
 * - 'owner' (the shared server 10.150.0.5, whose login has NO CREATEROLE): no role is created or
 *   altered — the api connects with the SAME login as migrate. Only steps 1 and 4 run.
 *
 * WHY here and not in initdb scripts: initdb scripts run only on an EMPTY volume and cannot read
 * env passwords later (ADR 0001, "Postgres / roles").
 *
 * PASSWORD SAFETY: the password travels ONLY as a bind parameter into a transaction-local setting
 * and is quoted by format('%L') inside the DO block — never concatenated into SQL text, never
 * logged.
 */
import type { Pool } from 'pg';

import type { Executor } from '../executor';
import { withTransaction } from '../transaction';
import { ADVISORY_LOCKS, APP_ROLE, DB_SCHEMA } from '../schema';
import { ensureLedger } from './ledger';

/** Transaction-local custom setting that carries the password into the DO block. */
const PASSWORD_SETTING = 'nexus.app_password';

/** WHY a guard: an empty/short password must never reach ALTER ROLE (same rule as migrate-config). */
export const MIN_APP_PASSWORD_LENGTH = 16;

/** How the api connects (DB_APP_ROLE_MODE, ADR 0002). */
export const APP_ROLE_MODE_VALUES = ['separate', 'owner'] as const;
export type AppRoleMode = (typeof APP_ROLE_MODE_VALUES)[number];

/**
 * - separate: the bootstrap manages role nexus_app with `password`; ./grants.ts gives it DML only.
 * - owner:    no runtime role at all; the api uses the migrate login (DATABASE_URL = MIGRATION_DATABASE_URL).
 */
export type AppRole = { mode: 'separate'; password: string } | { mode: 'owner' };

/** Step 1. */
export async function ensureSchema(exec: Executor): Promise<void> {
  await exec.query(`CREATE SCHEMA IF NOT EXISTS ${DB_SCHEMA}`);
}

/** Step 2 — race-safe across databases of the same cluster (roles are cluster-wide). */
export async function ensureAppRole(exec: Executor): Promise<void> {
  await exec.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '${APP_ROLE}') THEN
        BEGIN
          CREATE ROLE ${APP_ROLE} LOGIN;
        EXCEPTION WHEN duplicate_object THEN
          NULL;
        END;
      END IF;
    END
    $$
  `);
}

/** Step 3 — MUST run inside a transaction (the setting is transaction-local). */
export async function setAppRolePassword(exec: Executor, password: string): Promise<void> {
  if (password.length < MIN_APP_PASSWORD_LENGTH) {
    throw new Error(`${APP_ROLE} password must be at least ${MIN_APP_PASSWORD_LENGTH} characters`);
  }
  await exec.query('SELECT set_config($1, $2, true)', [PASSWORD_SETTING, password]);
  await exec.query(`
    DO $$
    BEGIN
      EXECUTE format('ALTER ROLE ${APP_ROLE} LOGIN PASSWORD %L', current_setting('${PASSWORD_SETTING}'));
    EXCEPTION WHEN OTHERS THEN
      -- Re-raise WITHOUT the failing statement in the error context (it holds the password).
      RAISE EXCEPTION 'ALTER ROLE ${APP_ROLE} failed: %', SQLERRM USING ERRCODE = SQLSTATE;
    END
    $$
  `);
  // Clear it immediately so nothing later in this transaction can read it back.
  await exec.query(`SELECT set_config($1, '', true)`, [PASSWORD_SETTING]);
}

/**
 * Runs the steps for `appRole.mode` in one transaction, serialised with other migrate runs on this
 * database. Owner mode NEVER touches a role (the shared server's login cannot, and must not).
 */
export async function bootstrapDatabase(pool: Pool, appRole: AppRole): Promise<void> {
  await withTransaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCKS.migrate]);
    await ensureSchema(client);
    if (appRole.mode === 'separate') {
      await ensureAppRole(client);
      await setAppRolePassword(client, appRole.password);
    }
    await ensureLedger(client);
  });
}
