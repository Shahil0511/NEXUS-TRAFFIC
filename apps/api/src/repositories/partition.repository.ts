/**
 * Monthly partition maintenance through the whitelisted SECURITY DEFINER SQL functions
 * (nexus_app has no DDL rights of its own).
 * @see ../../migrations/0001_helpers_and_partitions.sql
 */
import type { Pool } from 'pg';

import type { Executor } from '../db/executor';
import { DB_SCHEMA, type PartitionedTable } from '../db/schema';

export class PartitionRepository {
  constructor(private readonly db: Pool) {}

  /** SELECT traffic.ensure_partitions($1, $2) — returns the partition names that exist/were created. */
  async ensure(monthsBack: number, monthsAhead: number, exec: Executor = this.db): Promise<string[]> {
    const { rows } = await exec.query<{ name: string }>(
      `SELECT name FROM traffic.ensure_partitions($1, $2) AS name`,
      [monthsBack, monthsAhead],
    );
    return rows.map((r) => r.name);
  }

  /** SELECT traffic.drop_expired_partitions($1, $2) — returns the dropped partition names. */
  async dropExpired(table: PartitionedTable, keepMonths: number, exec: Executor = this.db): Promise<string[]> {
    const { rows } = await exec.query<{ name: string }>(
      `SELECT name FROM traffic.drop_expired_partitions($1, $2) AS name`,
      [table, keepMonths],
    );
    return rows.map((r) => r.name);
  }

  /**
   * How many partitions of `table` start after the current month (readiness: must be ≥ 1).
   * The lower bound is read from the partition's own bound expression, not from its name.
   */
  async countFuture(table: PartitionedTable, exec: Executor = this.db): Promise<number> {
    const { rows } = await exec.query<{ count: number }>(
      `SELECT count(*) AS count
         FROM pg_catalog.pg_inherits inh
         JOIN pg_catalog.pg_class parent ON parent.oid = inh.inhparent
         JOIN pg_catalog.pg_class child ON child.oid = inh.inhrelid
         JOIN pg_catalog.pg_namespace ns ON ns.oid = parent.relnamespace
        WHERE ns.nspname = $1
          AND parent.relname = $2
          AND substring(pg_get_expr(child.relpartbound, child.oid) FROM 'FROM \\(''([^'']+)''\\)')::timestamptz
              > date_trunc('month', now())`,
      [DB_SCHEMA, table],
    );
    return Number(rows[0]?.count ?? 0);
  }
}
