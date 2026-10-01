/**
 * Transaction helpers. Services call these; repositories just accept the client as `exec`.
 */
import type { Pool, PoolClient } from 'pg';

export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run `fn` in a transaction holding a transaction-scoped advisory lock. If another process holds
 * the lock, returns `{ ran: false }` immediately (jobs must not overlap across replicas).
 * The lock is released automatically at COMMIT/ROLLBACK — it can never leak.
 */
export async function withAdvisoryXactLock<T>(
  pool: Pool,
  lockKey: number,
  fn: (client: PoolClient) => Promise<T>,
): Promise<{ ran: true; result: T } | { ran: false }> {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS locked', [lockKey]);
    if (!rows[0]?.locked) return { ran: false } as const;
    return { ran: true, result: await fn(client) } as const;
  });
}
