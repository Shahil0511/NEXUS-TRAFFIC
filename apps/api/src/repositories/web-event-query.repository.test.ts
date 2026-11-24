/**
 * SQL-shape tests (no database) of the S3 read side: every table read is bounded by the window,
 * users are verified identities only, partial-index predicates are literal, values are parameters.
 * Results are covered by test/db/analytics-queries.integration.test.ts.
 */
import { BREAKDOWN_DIMENSION_VALUES, USER_DAILY_APP_ROWS_LIMIT } from '@nexus/shared';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import type { TrafficFilter } from '../domain/filters';
import { IDENTIFIED_SQL } from './coverage-predicates';
import { BREAKDOWN_COLUMNS, WebEventQueryRepository } from './web-event-query.repository';

const FILTER: TrafficFilter = {
  from: new Date('2026-10-01T00:00:00Z'),
  to: new Date('2026-10-02T00:00:00Z'),
  appId: '11111111-1111-4111-8111-111111111111',
  environments: null,
};
/** The same scope with an environment filter (ADR 0008). */
const STAGING: TrafficFilter = { ...FILTER, environments: ['staging'] };
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
    await repo.findUserEmail(USER_KEY, FILTER);
    await repo.listSessions(FILTER, { userKey: USER_KEY, limit: 3, offset: 0 });
    await repo.listTopPaths(FILTER, 5);
    await repo.listPageStats(FILTER, 5);
    await repo.listToolUsage(FILTER, 'hour', 5);
    await repo.listCountries(FILTER, 5);
    await repo.listCities(FILTER, 5);
    await repo.listUserDevices(USER_KEY, FILTER, 5);
    await repo.getUserLatestContext(USER_KEY, FILTER);
    await repo.listUserDailyActivity(USER_KEY, FILTER);
    expect(exec.statements).toHaveLength(12);
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
    await repo.getSession('app-id', SESSION_ID, {
      from: FILTER.from,
      to: FILTER.to,
      environments: null,
    });
    const [header, browser, api] = exec.statements;
    expect(header?.values).toContain('app-id');
    expect(browser?.text).toContain('ORDER BY w.seq, w.occurred_at, w.event_id');
    expect(api?.text).toMatch(/r\.app_id = \$\d+/);
    expect(api?.text).toMatch(/r\.session_id = \$\d+/);
    expect(api?.values).toContain('app-id');
  });
});

describe('WebEventQueryRepository person reads (devices, daily)', () => {
  /** The user key must be ONE bound parameter used on both tables, never inlined. */
  function expectKeyedOnBothTables(statement: { text: string; values: unknown[] } | undefined) {
    expect(statement?.text).toMatch(/r\.user_key = \$1(?!\d)/);
    expect(statement?.text).toMatch(/w\.user_key = \$1(?!\d)/);
    expect(statement?.values[0]).toBe(USER_KEY);
  }

  it('listUserDevices groups both tables by the ua_* columns, newest first, limited', async () => {
    const { exec, repo } = build();
    await repo.listUserDevices(USER_KEY, FILTER, 7);
    const [statement] = exec.statements;
    expectKeyedOnBothTables(statement);
    expect(statement?.text).toContain(
      'r.ua_device AS device, r.ua_browser AS browser, r.ua_os AS os',
    );
    expect(statement?.text).toContain('GROUP BY h.device, h.browser, h.os');
    expect(statement?.text).toContain('ORDER BY max(h.occurred_at) DESC');
    expect(statement?.text).toContain(
      "count(DISTINCT h.session_id) FILTER (WHERE h.kind <> 'api') AS visits",
    );
    expect(statement?.values.at(-1)).toBe(7);
  });

  it('getUserLatestContext reads the single newest browser event of the user', async () => {
    const { exec, repo } = build();
    expect(await repo.getUserLatestContext(USER_KEY, FILTER)).toBeNull();
    const text = exec.statements[0]?.text ?? '';
    expect(text).not.toContain('api_requests');
    expect(text).toMatch(/w\.user_key = \$\d+/);
    expect(text).toContain('w.client_tz, w.client_lang, w.release');
    expect(text).toContain('ORDER BY w.occurred_at DESC, w.event_id DESC');
    expect(text).toContain('LIMIT 1');
  });

  it('listUserDailyActivity answers one row per IST day and app, newest day first, then first activity', async () => {
    const { exec, repo } = build();
    await repo.listUserDailyActivity(USER_KEY, FILTER);
    const [statement] = exec.statements;
    const text = statement?.text ?? '';
    expectKeyedOnBothTables(statement);
    expect(text).toContain(
      "date_trunc('day', h.occurred_at, 'Asia/Kolkata') AS day, a.slug AS app",
    );
    expect(text).toContain(
      "coalesce(sum(h.visible_ms) FILTER (WHERE h.kind = 'page_time'), 0)::int8 AS active_ms",
    );
    expect(text).toContain('(r.status_code >= 400) AS failed');
    expect(text).toContain('GROUP BY 1, 2');
    expect(text).toContain('ORDER BY 1 DESC, 3 ASC, 2 ASC');
    expect(text).not.toContain('array_agg');
    const limit = /LIMIT \$(\d+)\s*$/.exec(text);
    expect(limit).not.toBeNull();
    expect(statement?.values[Number(limit?.[1]) - 1]).toBe(USER_DAILY_APP_ROWS_LIMIT + 1);
  });
});

// ─── Environment filter (ADR 0008) ──────────────────────────────────────────

/** Each `FROM traffic.<table> <alias>` must carry `<alias>.environment = ANY($n::text[])`. */
function expectEveryTableEnvFiltered(text: string): void {
  const aliases = [...text.matchAll(/FROM traffic\.(?:web_events|api_requests) (\w+)/g)].map(
    (match) => match[1],
  );
  expect(aliases.length).toBeGreaterThan(0);
  for (const alias of aliases) {
    expect(text, `alias ${alias}`).toMatch(
      new RegExp(`${alias}\\.environment = ANY\\(\\$\\d+::text\\[\\]\\)`),
    );
  }
}

/**
 * EVERY public read method, called with an env filter. Rows answer `[{}]` so composite methods
 * (profile, session, page / tool detail) run their follow-up statements too.
 */
const READS: Record<string, (repo: WebEventQueryRepository) => Promise<unknown>> = {
  summarizePageViews: (r) => r.summarizePageViews(STAGING),
  pageViewTimeseries: (r) => r.pageViewTimeseries(STAGING, 'hour'),
  countActiveUsers: (r) => r.countActiveUsers(STAGING),
  countIdentifiedUsers: (r) => r.countIdentifiedUsers(STAGING),
  summarizeActivityByApp: (r) => r.summarizeActivityByApp(STAGING),
  countByDimension: (r) => r.countByDimension('client_tz', STAGING, 5),
  countDeviceReturn: (r) => r.countDeviceReturn(STAGING, new Date('2026-09-01T00:00:00Z')),
  activityTimeseries: (r) => r.activityTimeseries(STAGING, 'minute'),
  listRecentEvents: (r) => r.listRecentEvents(STAGING, 5),
  listOnlineUsers: (r) => r.listOnlineUsers({ ...STAGING, userKey: USER_KEY }, 5),
  countOnlineByApp: (r) => r.countOnlineByApp(STAGING),
  listUsers: (r) => r.listUsers(STAGING, { limit: 3, offset: 0 }),
  getUserProfile: (r) => r.getUserProfile(USER_KEY, STAGING),
  listUserTimeline: (r) => r.listUserTimeline(USER_KEY, STAGING, { after: null, limit: 3 }),
  listUserDevices: (r) => r.listUserDevices(USER_KEY, STAGING, 5),
  getUserLatestContext: (r) => r.getUserLatestContext(USER_KEY, STAGING),
  findUserEmail: (r) => r.findUserEmail(USER_KEY, STAGING),
  listUserDailyActivity: (r) => r.listUserDailyActivity(USER_KEY, STAGING),
  listSessions: (r) => r.listSessions(STAGING, { userKey: USER_KEY, limit: 3, offset: 0 }),
  getSession: (r) => r.getSession('app-id', SESSION_ID, STAGING),
  listTopPaths: (r) => r.listTopPaths(STAGING, 5),
  listPageStats: (r) => r.listPageStats(STAGING, 5),
  listPageTemplates: (r) => r.listPageTemplates(STAGING),
  getPageDetail: (r) => r.getPageDetail('/ebo-sales/stores/:id', STAGING, 'hour'),
  listToolUsage: (r) => r.listToolUsage(STAGING, 'hour', 5),
  listToolNames: (r) => r.listToolNames(STAGING),
  getToolDetail: (r) => r.getToolDetail('export', STAGING, 'hour'),
  listDailyUsers: (r) => r.listDailyUsers(STAGING),
  listCountries: (r) => r.listCountries(STAGING, 5),
  listCities: (r) => r.listCities(STAGING, 5),
};
/** Private building blocks — reached through the composite methods above. */
const PRIVATE_METHODS = [
  'countUserTools',
  'countUserPages',
  'listUserCountries',
  'listSessionBrowserEvents',
  'listSessionApiCalls',
  'listUserApps',
  'countPageViewsPerBucket',
  'listPageViewers',
  'listPageTools',
  'listPageLinks',
  'listToolUsers',
  'countToolUses',
  'toolTrend',
];

describe('WebEventQueryRepository environment filter', () => {
  it('the READS table covers every method (a new read must be added here)', () => {
    const methods = Object.getOwnPropertyNames(WebEventQueryRepository.prototype).filter(
      (name) => name !== 'constructor' && !PRIVATE_METHODS.includes(name),
    );
    expect(methods.sort()).toEqual(Object.keys(READS).sort());
  });

  it.each(Object.entries(READS))(
    '%s filters EVERY table of EVERY statement by environment (one bound array)',
    async (_name, read) => {
      const { exec, repo } = build();
      exec.rows = [{}];
      await read(repo);
      expect(exec.statements.length).toBeGreaterThan(0);
      for (const { text, values } of exec.statements) {
        expectEveryTableEnvFiltered(text);
        expect(text).not.toContain("'staging'");
        expect(values).toContainEqual(['staging']);
      }
    },
  );

  it('env=all (null) adds no environment predicate', async () => {
    const { exec, repo } = build();
    await repo.listUsers(FILTER, { limit: 3, offset: 0 });
    await repo.listOnlineUsers(FILTER, 5);
    for (const { text } of exec.statements) expect(text).not.toContain('environment');
  });
});

describe('WebEventQueryRepository breakdown and devices', () => {
  it('BREAKDOWN_COLUMNS whitelists every dimension (frozen, web_events columns only)', () => {
    expect(Object.keys(BREAKDOWN_COLUMNS).sort()).toEqual([...BREAKDOWN_DIMENSION_VALUES].sort());
    expect(Object.isFrozen(BREAKDOWN_COLUMNS)).toBe(true);
    for (const column of Object.values(BREAKDOWN_COLUMNS)) expect(column).toMatch(/^w\.[a-z_]+$/);
  });

  it('counts page views by the whitelisted column, total over all groups', async () => {
    const { exec, repo } = build();
    await repo.countByDimension('client_lang', FILTER, 7);
    const [statement] = exec.statements;
    expect(statement?.text).toContain('SELECT w.client_lang AS value');
    expect(statement?.text).toContain('GROUP BY w.client_lang');
    expect(statement?.text).toContain('sum(count(*)) OVER ()::int8 AS total');
    expect(statement?.text).toContain("w.event_type = 'page_view'");
    expect(statement?.values.at(-1)).toBe(7);
  });

  it('time_reason is counted over page_time rows (the only rows that carry it)', async () => {
    const { exec, repo } = build();
    await repo.countByDimension('time_reason', FILTER, 7);
    expect(exec.statements[0]?.text).toContain("w.event_type = 'page_time'");
  });

  it('the returning-device lookback is bounded on both sides: [lookbackFrom, from)', async () => {
    const { exec, repo } = build();
    const lookbackFrom = new Date('2026-09-01T00:00:00Z');
    expect(await repo.countDeviceReturn(FILTER, lookbackFrom)).toEqual({
      devices: 0,
      returning_devices: 0,
    });
    const [statement] = exec.statements;
    expectEveryTableBounded(statement?.text ?? '');
    expect(statement?.values).toEqual([
      FILTER.from,
      FILTER.to,
      FILTER.appId,
      lookbackFrom,
      FILTER.from,
      FILTER.appId,
    ]);
    expect(statement?.text).toContain('anonymous_id IS NOT NULL');
  });

  it('summarizeActivityByApp counts identified rows with IDENTIFIED_SQL (both sources combined)', async () => {
    const { exec, repo } = build();
    await repo.summarizeActivityByApp(FILTER);
    expect(exec.statements[0]?.text).toContain(
      `FILTER (WHERE ${IDENTIFIED_SQL('h')}) AS identified`,
    );
  });
});
