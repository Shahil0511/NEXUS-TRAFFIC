/**
 * SQL-shape tests (no database) of the S3 read side: every table read is bounded by the window,
 * users are verified identities only, partial-index predicates are literal, values are parameters.
 * Results are covered by test/db/analytics-queries.integration.test.ts.
 */
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import type { TrafficFilter } from '../domain/filters';
import { WebEventQueryRepository } from './web-event-query.repository';

const FILTER: TrafficFilter = {
  from: new Date('2026-10-01T00:00:00Z'),
  to: new Date('2026-10-02T00:00:00Z'),
  appId: '11111111-1111-4111-8111-111111111111',
};
const USER_KEY = Buffer.alloc(32, 0xab);
const SESSION_ID = '55555555-5555-4555-8555-555555555555';

/** Records every statement; answers with `rows` (default: none). */
class RecordingExecutor {
  readonly statements: Array<{ text: string; values: unknown[] }> = [];
  rows: unknown[] = [];
  async query(text: string, values: unknown[] = []) {
    this.statements.push({ text, values });
    return { rows: this.rows };
  }
}

function build() {
  const exec = new RecordingExecutor();
  const repo = new WebEventQueryRepository(exec as unknown as Pool);
  return { exec, repo };
}

/** Each `FROM traffic.<table> <alias>` must have `<alias>.occurred_at >= $n AND < $m`. */
function expectEveryTableBounded(text: string): void {
  const aliases = [...text.matchAll(/FROM traffic\.(?:web_events|api_requests) (\w+)/g)].map(
    (match) => match[1],
  );
  expect(aliases.length).toBeGreaterThan(0);
  for (const alias of aliases) {
    expect(text).toMatch(new RegExp(`${alias}\\.occurred_at >= \\$\\d+`));
    expect(text).toMatch(new RegExp(`${alias}\\.occurred_at < \\$\\d+`));
  }
}

describe('WebEventQueryRepository SQL (S3)', () => {
  it('every statement of every read method bounds every table by the window', async () => {
    const { exec, repo } = build();
    await repo.listUsers(FILTER, { search: 'a', limit: 3, offset: 0 });
    await repo.listUserTimeline(USER_KEY, FILTER, { after: null, limit: 3 });
    await repo.listSessions(FILTER, { userKey: USER_KEY, limit: 3, offset: 0 });
    await repo.listTopPaths(FILTER, 5);
    await repo.listPageStats(FILTER, 5);
    await repo.listToolUsage(FILTER, 'hour', 5);
    await repo.listCountries(FILTER, 5);
    await repo.listCities(FILTER, 5);
    expect(exec.statements).toHaveLength(8);
    for (const { text } of exec.statements) expectEveryTableBounded(text);
  });

  it('users are verified identities only; the search is a parameterised ILIKE', async () => {
    const { exec, repo } = build();
    await repo.listUsers(FILTER, { search: '50%', limit: 3, offset: 0 });
    const [statement] = exec.statements;
    expect(statement?.text).toContain('r.user_key IS NOT NULL');
    expect(statement?.text).toContain('w.user_key IS NOT NULL');
    expect(statement?.text).toMatch(/user_email ILIKE \$\d+/);
    expect(statement?.values).toContain('%50\\%%');
    expect(statement?.text).not.toContain('50%');
  });

  it('the timeline pages both tables with the same keyset and folds page_time away', async () => {
    const { exec, repo } = build();
    await repo.listUserTimeline(USER_KEY, FILTER, {
      after: { occurredAt: '2026-10-01T12:00:00.000001Z', eventId: SESSION_ID },
      limit: 3,
    });
    const text = exec.statements[0]?.text ?? '';
    expect(text).toMatch(/\(r\.occurred_at, r\.event_id\) < \(\$\d+::timestamptz, \$\d+::uuid\)/);
    expect(text).toMatch(/\(w\.occurred_at, w\.event_id\) < \(\$\d+::timestamptz, \$\d+::uuid\)/);
    expect(text).toContain("w.event_type <> 'page_time'");
    expect(exec.statements[0]?.values).toContain('2026-10-01T12:00:00.000001Z');
  });

  it('tool queries carry the partial-index predicate literally; no trend query without tools', async () => {
    const { exec, repo } = build();
    const rows = await repo.listToolUsage(FILTER, 'day', 5);
    expect(rows).toEqual({ tools: [], trend: [] });
    expect(exec.statements).toHaveLength(1);
    expect(exec.statements[0]?.text).toContain('w.tool IS NOT NULL');
  });

  it('getUserProfile / getSession stop after the header when there is no row (→ 404)', async () => {
    const { exec, repo } = build();
    expect(await repo.getUserProfile(USER_KEY, FILTER)).toBeNull();
    expect(await repo.getSession(FILTER.appId ?? '', SESSION_ID, FILTER)).toBeNull();
    expect(exec.statements).toHaveLength(2);
  });

  it('getSession reads the browser events in replay order and the API calls of the same app', async () => {
    const { exec, repo } = build();
    exec.rows = [{}];
    await repo.getSession('app-id', SESSION_ID, { from: FILTER.from, to: FILTER.to });
    const [header, browser, api] = exec.statements;
    expect(header?.values).toContain('app-id');
    expect(browser?.text).toContain('ORDER BY w.seq, w.occurred_at, w.event_id');
    expect(api?.text).toMatch(/r\.app_id = \$\d+/);
    expect(api?.text).toMatch(/r\.session_id = \$\d+/);
    expect(api?.values).toContain('app-id');
  });
});
