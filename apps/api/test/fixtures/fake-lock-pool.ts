/**
 * Test-only stand-in for a pg Pool as used by withAdvisoryXactLock (src/db/transaction.ts):
 * connect() → BEGIN → pg_try_advisory_xact_lock → … → COMMIT/ROLLBACK → release().
 *
 * WHY: the jobs must run their work on the SAME client that holds the advisory lock; tests assert
 * that by comparing the client the service received with `pool.client`.
 */
import type { Pool, PoolClient } from 'pg';

export interface FakeLockPool {
  pool: Pool;
  /** The one client every connect() hands out. */
  client: PoolClient;
  /** SQL text + params of every query the client ran, in order. */
  queries: Array<{ sql: string; params?: unknown[] }>;
  released: number;
}

/** `locked: false` simulates another replica holding the lock. */
export function fakeLockPool(options: { locked?: boolean } = {}): FakeLockPool {
  const locked = options.locked ?? true;
  const state: FakeLockPool = {
    pool: undefined as unknown as Pool,
    client: undefined as unknown as PoolClient,
    queries: [],
    released: 0,
  };
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      state.queries.push({ sql, params });
      if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ locked }] };
      return { rows: [] };
    },
    release: () => {
      state.released += 1;
    },
  };
  state.client = client as unknown as PoolClient;
  state.pool = { connect: async () => client } as unknown as Pool;
  return state;
}
