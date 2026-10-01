/**
 * Append-only admin audit trail (`traffic.admin_audit_log`).
 * @see ../../migrations/0003_admin_audit_log.sql
 */
import type { Pool } from 'pg';

import type { Executor } from '../db/executor';
import type { AuditEntry } from '../domain/inserts';
import { notImplemented } from '../lib/not-implemented';

export class AdminAuditRepository {
  constructor(private readonly db: Pool) {}

  async record(entry: AuditEntry, exec: Executor = this.db): Promise<void> {
    void entry;
    void exec;
    throw notImplemented('AdminAuditRepository.record');
  }
}
