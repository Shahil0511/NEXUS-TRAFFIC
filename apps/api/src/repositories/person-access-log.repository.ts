/**
 * The person access log (`traffic.person_access_log`): append and read, nothing else. Runs on the
 * WRITE pool (the query pool is read-only), like the admin audit log.
 *
 * INVARIANTS
 * - Append-only: there is no update or delete method, nexus_app has SELECT + INSERT only
 *   (grants.ts) and triggers refuse UPDATE, DELETE and TRUNCATE for every role.
 * - The person is stored as user_key + an ALREADY-MASKED email; a CHECK refuses anything else.
 * - Reads are newest first on (viewed_at, id), keyset-paged; values always go through `$n`.
 * @see ../../migrations/0013_person_access_log.sql
 * @see ../../migrations/0014_person_access_surfaces_day_pattern_visit_steps.sql (surface CHECK widened)
 */
import type { Pool } from 'pg';

import type { Executor } from '../db/executor';
import { keysetTimeExpr, ParamList } from '../db/sql';
import type { AccessLogListOptions } from '../domain/filters';
import type { PersonAccessInsert } from '../domain/inserts';
import type { PersonAccessLogRow } from '../domain/rows';

export class PersonAccessLogRepository {
  constructor(private readonly db: Pool) {}

  /** Appends one person-page open. */
  async record(entry: PersonAccessInsert, exec: Executor = this.db): Promise<void> {
    await exec.query(
      `INSERT INTO traffic.person_access_log
         (viewer_email, subject_user_key, subject_email_masked, surface)
       VALUES ($1, $2, $3, $4)`,
      [entry.viewerEmail, entry.subjectUserKey, entry.subjectEmailMasked, entry.surface],
    );
  }

  /**
   * One page of the log, newest first, optionally about one person only. Asks for
   * `options.limit` rows (the service passes limit + 1 to detect a next page).
   */
  async list(
    options: AccessLogListOptions,
    exec: Executor = this.db,
  ): Promise<PersonAccessLogRow[]> {
    const params = new ParamList();
    const where: string[] = [];
    if (options.subjectUserKey) {
      where.push(`l.subject_user_key = ${params.add(options.subjectUserKey)}`);
    }
    if (options.after) {
      where.push(
        `(l.viewed_at, l.id) < (${params.add(options.after.viewedAt)}::timestamptz, ${params.add(options.after.id)}::int8)`,
      );
    }
    const { rows } = await exec.query<PersonAccessLogRow>(
      `SELECT l.id, l.viewed_at, ${keysetTimeExpr('l.viewed_at')} AS viewed_at_key,
              l.viewer_email, l.subject_user_key, l.subject_email_masked, l.surface
         FROM traffic.person_access_log l
        ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY l.viewed_at DESC, l.id DESC
        LIMIT ${params.add(options.limit)}`,
      params.values,
    );
    return rows;
  }
}
