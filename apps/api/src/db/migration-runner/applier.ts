/**
 * Applies ONE migration file atomically: BEGIN → advisory lock → (re-check ledger) → run SQL →
 * record → COMMIT. A failure rolls back both the SQL and the ledger row, so a half-applied
 * migration can never exist.
 *
 * WHY the lock + re-check: two `migrate` containers started together (or a manual run during a
 * deploy) must not both apply the same file; the second one waits, sees it recorded, and skips.
 */
import type { Pool } from 'pg';

import { withTransaction } from '../transaction';
import { ADVISORY_LOCKS } from '../schema';
import { isRecorded, recordMigration } from './ledger';
import type { MigrationFile } from './loader';

export type ApplyOutcome =
  | { status: 'applied'; executionMs: number }
  | { status: 'skipped' };

/** Runs `file.sql` (may hold several statements; MUST NOT contain BEGIN/COMMIT) in one transaction. */
export async function applyMigration(pool: Pool, file: MigrationFile): Promise<ApplyOutcome> {
  return withTransaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCKS.migrate]);
    if (await isRecorded(client, file.version)) return { status: 'skipped' } as const;
    const startedAt = performance.now();
    await client.query(file.sql);
    const executionMs = performance.now() - startedAt;
    await recordMigration(client, file, executionMs);
    return { status: 'applied', executionMs } as const;
  });
}
