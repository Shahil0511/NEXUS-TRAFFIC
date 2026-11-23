/**
 * SQL-shape tests (no database) of the person access log. Results, the CHECKs and the
 * append-only triggers are covered by test/db/analytics-queries.integration.test.ts and
 * test/db/privileges.integration.test.ts.
 */
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { PersonAccessLogRepository } from './person-access-log.repository';

class RecordingExecutor {
  readonly statements: Array<{ text: string; values: unknown[] }> = [];
  async query(text: string, values: unknown[] = []) {
    this.statements.push({ text, values });
    return { rows: [] };
  }
}

function build() {
  const exec = new RecordingExecutor();
  return { exec, repo: new PersonAccessLogRepository(exec as unknown as Pool) };
}

describe('PersonAccessLogRepository', () => {
  it('has no update or delete method (append-only by design)', () => {
    const methods = Object.getOwnPropertyNames(PersonAccessLogRepository.prototype).filter(
      (name) => name !== 'constructor',
    );
    expect(methods.sort()).toEqual(['list', 'record']);
  });

  it('record: one parameterised INSERT of the four columns', async () => {
    const { exec, repo } = build();
    const key = Buffer.alloc(32, 1);
    await repo.record({
      viewerEmail: 'boss@libas.in',
      subjectUserKey: key,
      subjectEmailMasked: 's***@libas.in',
      surface: 'person_daily',
    });
    const [statement] = exec.statements;
    expect(statement?.text).toMatch(/^INSERT INTO traffic\.person_access_log/);
    expect(statement?.text).not.toContain('libas.in');
    expect(statement?.values).toEqual(['boss@libas.in', key, 's***@libas.in', 'person_daily']);
  });

  it('list: newest first on (viewed_at, id), limit as a parameter, no WHERE by default', async () => {
    const { exec, repo } = build();
    await repo.list({ after: null, limit: 51 });
    const [statement] = exec.statements;
    expect(statement?.text).toContain('ORDER BY l.viewed_at DESC, l.id DESC');
    expect(statement?.text).not.toContain('WHERE');
    expect(statement?.text).toContain("to_char(l.viewed_at AT TIME ZONE 'UTC'");
    expect(statement?.values).toEqual([51]);
  });

  it('list: the person scope and the keyset are bound values', async () => {
    const { exec, repo } = build();
    const key = Buffer.alloc(32, 2);
    await repo.list({
      subjectUserKey: key,
      after: { viewedAt: '2026-10-01T09:00:00.000001Z', id: 7 },
      limit: 11,
    });
    const [statement] = exec.statements;
    expect(statement?.text).toContain('l.subject_user_key = $1');
    expect(statement?.text).toContain('(l.viewed_at, l.id) < ($2::timestamptz, $3::int8)');
    expect(statement?.values).toEqual([key, '2026-10-01T09:00:00.000001Z', 7, 11]);
  });
});
