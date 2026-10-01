/**
 * Monthly partition maintenance through the whitelisted SECURITY DEFINER SQL functions
 * (nexus_app has no DDL rights of its own).
 * @see ../../migrations/0001_helpers_and_partitions.sql
 */
import type { Pool } from 'pg';

import type { Executor } from '../db/executor';
import type { PartitionedTable } from '../db/schema';
import { notImplemented } from '../lib/not-implemented';

export class PartitionRepository {
  constructor(private readonly db: Pool) {}

  /** SELECT traffic.ensure_partitions($1, $2) — returns the partition names that exist/were created. */
  async ensure(monthsBack: number, monthsAhead: number, exec: Executor = this.db): Promise<string[]> {
    void monthsBack;
    void monthsAhead;
    void exec;
    throw notImplemented('PartitionRepository.ensure');
  }

  /** SELECT traffic.drop_expired_partitions($1, $2) — returns the dropped partition names. */
  async dropExpired(table: PartitionedTable, keepMonths: number, exec: Executor = this.db): Promise<string[]> {
    void table;
    void keepMonths;
    void exec;
    throw notImplemented('PartitionRepository.dropExpired');
  }

  /** How many partitions of `table` start after the current month (readiness: must be ≥ 1). */
  async countFuture(table: PartitionedTable, exec: Executor = this.db): Promise<number> {
    void table;
    void exec;
    throw notImplemented('PartitionRepository.countFuture');
  }
}
