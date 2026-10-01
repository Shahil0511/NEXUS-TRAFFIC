/**
 * Append-only admin audit trail (`traffic.admin_audit_log`).
 * @see ../../migrations/0003_admin_audit_log.sql
 */
import type { Pool } from 'pg';

import type { Executor } from '../db/executor';
import type { AuditEntry } from '../domain/inserts';

export class AdminAuditRepository {
  constructor(private readonly db: Pool) {}

  /** Appends one entry (details ≤ 4 KB, enforced by a CHECK). There is no update/delete — by design. */
  async record(entry: AuditEntry, exec: Executor = this.db): Promise<void> {
    await exec.query(
      `INSERT INTO traffic.admin_audit_log (actor_email, action, target_type, target_id, details)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        entry.actorEmail,
        entry.action,
        entry.targetType,
        entry.targetId,
        entry.details === undefined ? null : JSON.stringify(entry.details),
      ],
    );
  }
}
