/**
 * Privileges of the runtime role nexus_app — DML only, NO DDL, no TRUNCATE, and admin_audit_log is
 * append-only. Partition DDL happens only through the whitelisted SECURITY DEFINER functions of
 * 0001. The default privileges cover tables the owner creates later, including the monthly
 * partitions created by traffic.ensure_monthly_partition.
 *
 * WHY code and not a migration (ADR 0002): the role split is OPTIONAL. In DB_APP_ROLE_MODE=owner
 * (the shared server, whose login cannot create roles) nexus_app does not exist, so a migration
 * that GRANTs to it would fail. In 'separate' mode the runner calls applyAppRoleGrantsLocked() after
 * the migrations on EVERY apply run; every statement is idempotent, so re-running is a no-op that
 * also repairs a revoked grant and covers tables added by new migrations.
 *
 * Verified by test/db/privileges.integration.test.ts and test/db/migration-runner.integration.test.ts.
 * @see ./runner.ts
 * @see ../../../migrations/0001_helpers_and_partitions.sql
 */
import type { Pool } from 'pg';

import type { Executor } from '../executor';
import { withTransaction } from '../transaction';
import { ADVISORY_LOCKS, APP_ROLE } from '../schema';

/** The statements, in order. Identifiers are constants (never input). */
export const APP_ROLE_GRANT_STATEMENTS: readonly string[] = [
  `GRANT USAGE ON SCHEMA traffic TO ${APP_ROLE}`,

  `GRANT SELECT, INSERT, UPDATE, DELETE
     ON traffic.apps, traffic.api_keys, traffic.api_requests, traffic.web_events,
        traffic.ingest_counters
     TO ${APP_ROLE}`,

  `GRANT SELECT, INSERT ON traffic.admin_audit_log TO ${APP_ROLE}`,

  `GRANT SELECT ON traffic.schema_migrations TO ${APP_ROLE}`,

  `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA traffic TO ${APP_ROLE}`,

  `GRANT EXECUTE ON FUNCTION traffic.ensure_monthly_partition(text, date) TO ${APP_ROLE}`,
  `GRANT EXECUTE ON FUNCTION traffic.ensure_partitions(int, int) TO ${APP_ROLE}`,
  `GRANT EXECUTE ON FUNCTION traffic.drop_expired_partitions(text, int) TO ${APP_ROLE}`,

  `ALTER DEFAULT PRIVILEGES IN SCHEMA traffic
     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE}`,

  `ALTER DEFAULT PRIVILEGES IN SCHEMA traffic
     GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE}`,
];

/** Runs every grant on `exec` (call inside a transaction). Idempotent. */
export async function applyAppRoleGrants(exec: Executor): Promise<void> {
  for (const statement of APP_ROLE_GRANT_STATEMENTS) {
    await exec.query(statement);
  }
}

/** One transaction holding the migrate advisory lock, so grants never interleave with another run. */
export async function applyAppRoleGrantsLocked(pool: Pool): Promise<void> {
  await withTransaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCKS.migrate]);
    await applyAppRoleGrants(client);
  });
}
