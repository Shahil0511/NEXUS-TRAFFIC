/**
 * SQL-shape tests (no database) of the S3 read side: every table read is bounded by the window,
 * users are verified identities only, partial-index predicates are literal, values are parameters.
 * Results are covered by test/db/analytics-queries.integration.test.ts.
 */
import {
  BREAKDOWN_DIMENSION_VALUES,
  USER_DAILY_APP_ROWS_LIMIT,
  USER_DAY_BLOCK_GAP_MS,
  VISIBLE_DELTA_CREDIT_CAP_MS,
} from '@nexus/shared';
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
/** The credited (capped, NULL-safe) visible ms of one row of `alias` — spelled out, not imported (ADR 0017). */
const CAPPED = (alias: string): string =>
  `(CASE WHEN ${alias}.visible_ms > ${VISIBLE_DELTA_CREDIT_CAP_MS} THEN ${VISIBLE_DELTA_CREDIT_CAP_MS} ELSE ${alias}.visible_ms END)`;
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
    await repo.listUserDayBlocks(USER_KEY, FILTER, 96);
    await repo.listUserDayPages(USER_KEY, FILTER, 30);
    await repo.listUserDayTools(USER_KEY, FILTER, 30);
    await repo.listUserActivityPattern(USER_KEY, FILTER);
    expect(exec.statements).toHaveLength(16);
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
      `coalesce(sum(${CAPPED('h')}) FILTER (WHERE h.kind = 'page_time'), 0)::int8 AS active_ms`,
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

describe('WebEventQueryRepository one person-day (blocks, pages, tools)', () => {
  /** The bound value of the LAST `LIMIT $n` of a statement. */
  function limitOf(statement: { text: string; values: unknown[] } | undefined): unknown {
    const match = /LIMIT \$(\d+)\s*$/.exec(statement?.text ?? '');
    return match ? statement?.values[Number(match[1]) - 1] : undefined;
  }
  /** Columns that carry free text or identity; the one-day reads touch none of them. */
  const NEVER_READ = /\b(?:label|props|value|ip|user_email|claimed_email|name)\b|host\(/;

  it('blocks: page_time covers its credited delta, clamped to the day start; other events are points', async () => {
    const { exec, repo } = build();
    await repo.listUserDayBlocks(USER_KEY, FILTER, 96);
    const [statement] = exec.statements;
    const text = statement?.text ?? '';
    expect(text).toContain(
      `greatest(w.occurred_at - coalesce(${CAPPED('w')}, 0) * interval '1 millisecond', $`,
    );
    const clamp = /interval '1 millisecond', \$(\d+)::timestamptz\)/.exec(text);
    expect(statement?.values[Number(clamp?.[1]) - 1]).toBe(FILTER.from);
    expect(text).toContain(
      `CASE WHEN w.event_type = 'page_time' THEN ${CAPPED('w')} END AS credited_ms`,
    );
    expect(text).toContain('ELSE w.occurred_at END AS s');
  });

  it('blocks: a running max of the earlier ends splits at the join gap; islands give time in app', async () => {
    const { exec, repo } = build();
    await repo.listUserDayBlocks(USER_KEY, FILTER, 96);
    const text = exec.statements[0]?.text ?? '';
    expect(text).toContain(
      'WINDOW before_row AS (ORDER BY iv.s, iv.e, iv.event_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)',
    );
    expect(text).toContain(`o.s >= o.prev_end + interval '${USER_DAY_BLOCK_GAP_MS} milliseconds'`);
    expect(text).toContain(
      "max(iv.e) FILTER (WHERE iv.event_type = 'page_time') OVER before_row AS prev_page_end",
    );
    expect(text).toContain('(o.prev_page_end IS NULL OR o.s > o.prev_page_end)');
    expect(text).toContain('extract(epoch FROM i.island_end - i.island_start)');
    expect(text).toContain('array_agg(DISTINCT a.slug ORDER BY a.slug) AS apps');
  });

  it('blocks: the LATERAL call count is bounded, env-filtered and keyed like the outer read', async () => {
    const { exec, repo } = build();
    await repo.listUserDayBlocks(USER_KEY, STAGING, 96);
    const [statement] = exec.statements;
    const text = statement?.text ?? '';
    const lateral = text.slice(text.indexOf('CROSS JOIN LATERAL'));
    expect(lateral).toMatch(/r\.occurred_at >= \$\d+ AND r\.occurred_at < \$\d+/);
    expect(lateral).toMatch(/r\.app_id = \$\d+/);
    expect(lateral).toMatch(/r\.environment = ANY\(\$\d+::text\[\]\)/);
    expect(lateral).toMatch(/r\.user_key = \$1(?!\d)/);
    expect(lateral).toContain('r.occurred_at >= b.start_at AND r.occurred_at <= b.end_at');
    expect(text).toMatch(/w\.user_key = \$1(?!\d)/);
    expect(statement?.values[0]).toBe(USER_KEY);
  });

  it('blocks: the day totals are window functions before the LIMIT, in start order', async () => {
    const { exec, repo } = build();
    await repo.listUserDayBlocks(USER_KEY, FILTER, 96);
    const [statement] = exec.statements;
    const text = statement?.text ?? '';
    expect(text).toContain(
      '(sum(coalesce(c.time_in_app_ms, 0)) OVER ())::int8 AS day_time_in_app_ms',
    );
    expect(text).toContain('(sum(q.requests) OVER ())::int8 AS requests_in_blocks');
    expect(text).toContain('count(*) OVER () AS block_count');
    expect(text.indexOf('OVER ()')).toBeLessThan(text.lastIndexOf('LIMIT'));
    expect(text).toMatch(/ORDER BY b\.start_at ASC\s+LIMIT \$\d+\s*$/);
    expect(limitOf(statement)).toBe(96);
  });

  it('pages: first-view order, credited tab visible time, the total over every page', async () => {
    const { exec, repo } = build();
    await repo.listUserDayPages(USER_KEY, FILTER, 30);
    const [statement] = exec.statements;
    const text = statement?.text ?? '';
    expect(text).toMatch(/w\.user_key = \$\d+/);
    expect(text).toContain("w.event_type IN ('page_view', 'page_time')");
    expect(text).toContain(
      `coalesce(sum(${CAPPED('w')}) FILTER (WHERE w.event_type = 'page_time'), 0)::int8 AS active_ms`,
    );
    expect(text).toContain('count(*) OVER () AS total');
    expect(text).toContain('GROUP BY a.slug, w.path_template');
    expect(text).toContain('ORDER BY min(w.occurred_at) ASC, a.slug ASC, w.path_template ASC');
    expect(limitOf(statement)).toBe(30);
  });

  it('tools: first-use order (not by uses), the partial-index predicate, the total', async () => {
    const { exec, repo } = build();
    await repo.listUserDayTools(USER_KEY, FILTER, 30);
    const [statement] = exec.statements;
    const text = statement?.text ?? '';
    expect(text).toMatch(/w\.user_key = \$\d+/);
    expect(text).toContain("w.tool IS NOT NULL AND w.event_type = 'tool_use'");
    expect(text).toContain('ORDER BY first_use_at ASC, a.slug ASC, w.tool ASC');
    expect(text).not.toContain('ORDER BY uses');
    expect(text).toContain('count(*) OVER () AS total');
    expect(limitOf(statement)).toBe(30);
  });

  it.each([
    [
      'listUserDayBlocks',
      (r: WebEventQueryRepository) => r.listUserDayBlocks(USER_KEY, FILTER, 96),
    ],
    ['listUserDayPages', (r: WebEventQueryRepository) => r.listUserDayPages(USER_KEY, FILTER, 30)],
    ['listUserDayTools', (r: WebEventQueryRepository) => r.listUserDayTools(USER_KEY, FILTER, 30)],
  ] as const)(
    '%s selects no label, props, value, name, ip or email column',
    async (_name, read) => {
      const { exec, repo } = build();
      await read(repo);
      expect(exec.statements[0]?.text ?? '').not.toMatch(NEVER_READ);
    },
  );
});

describe('WebEventQueryRepository usual activity hours (pattern)', () => {
  const LOCAL = "(h.occurred_at AT TIME ZONE 'Asia/Kolkata')";

  it('groups both tables by IST weekday and hour, keyed by ONE bound user key', async () => {
    const { exec, repo } = build();
    await repo.listUserActivityPattern(USER_KEY, FILTER);
    const [statement] = exec.statements;
    const text = statement?.text ?? '';
    expect(exec.statements).toHaveLength(1);
    expect(text).toMatch(/r\.user_key = \$1(?!\d)/);
    expect(text).toMatch(/w\.user_key = \$1(?!\d)/);
    expect(statement?.values[0]).toBe(USER_KEY);
    expect(text).toContain(`extract(isodow FROM ${LOCAL})::int AS weekday`);
    expect(text).toContain(`extract(hour FROM ${LOCAL})::int AS hour`);
    // The UTC weekday / hour would be off by 5:30: never read the raw column.
    expect(text).not.toMatch(/extract\(\w+ FROM h\.occurred_at\)/);
  });

  it('counts distinct IST days per cell, credits tab visible time, and adds the total row', async () => {
    const { exec, repo } = build();
    await repo.listUserActivityPattern(USER_KEY, FILTER);
    const text = exec.statements[0]?.text ?? '';
    expect(text).toContain(
      "count(DISTINCT date_trunc('day', h.occurred_at, 'Asia/Kolkata')) AS active_days",
    );
    expect(text).toContain(
      `coalesce(sum(${CAPPED('h')}) FILTER (WHERE h.kind = 'page_time'), 0)::int8 AS active_ms`,
    );
    expect(text).toContain("'api'::text AS kind, NULL::int AS visible_ms");
    expect(text).toContain('GROUP BY GROUPING SETS ((1, 2), ())');
    // At most 7 × 24 + 1 rows: no LIMIT needed.
    expect(text).not.toContain('LIMIT');
  });

  it('renders the exact statement the switch-on gate in PROGRESS.md asks the owner to EXPLAIN', async () => {
    // @see ../../../../ai-context/PROGRESS.md (2026-11-25, step 6, "Gate to switch it on"): when this
    // text changes, change the PREPARE statement there in the same commit.
    const { exec, repo } = build();
    await repo.listUserActivityPattern(USER_KEY, { ...FILTER, environments: ['prod'] });
    const [statement] = exec.statements;
    const oneLine = (statement?.text ?? '').replace(/\s+/g, ' ').trim();
    const table = (name: string, a: string, first: number): string =>
      `FROM traffic.${name} ${a} WHERE ${a}.occurred_at >= $${first}` +
      ` AND ${a}.occurred_at < $${first + 1} AND ${a}.app_id = $${first + 2}` +
      ` AND ${a}.environment = ANY($${first + 3}::text[]) AND ${a}.user_key = $1`;
    expect(oneLine).toBe(
      [
        `SELECT extract(isodow FROM ${LOCAL})::int AS weekday,`,
        `extract(hour FROM ${LOCAL})::int AS hour,`,
        "count(DISTINCT date_trunc('day', h.occurred_at, 'Asia/Kolkata')) AS active_days,",
        `coalesce(sum(${CAPPED('h')}) FILTER (WHERE h.kind = 'page_time'), 0)::int8 AS active_ms`,
        "FROM ( SELECT r.occurred_at, 'api'::text AS kind, NULL::int AS visible_ms",
        table('api_requests', 'r', 2),
        'UNION ALL SELECT w.occurred_at, w.event_type, w.visible_ms',
        table('web_events', 'w', 6),
        ') h GROUP BY GROUPING SETS ((1, 2), ()) ORDER BY 1 ASC NULLS FIRST, 2 ASC NULLS FIRST',
      ].join(' '),
    );
    // Parameter order: user_key, then (from, to, app_id, environments) per table.
    expect(statement?.values).toEqual([
      USER_KEY,
      FILTER.from,
      FILTER.to,
      FILTER.appId,
      ['prod'],
      FILTER.from,
      FILTER.to,
      FILTER.appId,
      ['prod'],
    ]);
  });

  it('selects no label, props, value, name, ip or email column', async () => {
    const { exec, repo } = build();
    await repo.listUserActivityPattern(USER_KEY, FILTER);
    expect(exec.statements[0]?.text ?? '').not.toMatch(
      /\b(?:label|props|value|ip|user_email|claimed_email|name|session_id)\b|host\(/,
    );
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
  listUserDayBlocks: (r) => r.listUserDayBlocks(USER_KEY, STAGING, 96),
  listUserDayPages: (r) => r.listUserDayPages(USER_KEY, STAGING, 30),
  listUserDayTools: (r) => r.listUserDayTools(USER_KEY, STAGING, 30),
  listUserActivityPattern: (r) => r.listUserActivityPattern(USER_KEY, STAGING),
  listSessions: (r) => r.listSessions(STAGING, { userKey: USER_KEY, limit: 3, offset: 0 }),
  getSession: (r) => r.getSession('app-id', SESSION_ID, STAGING),
  findSessionUserKey: (r) => r.findSessionUserKey('app-id', SESSION_ID, STAGING),
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

/** One credited row (the CAPPED shape, any alias and number): stripped before looking for raw sums. */
const CREDITED_ROW = /\(CASE WHEN (\w+)\.visible_ms > \d+ THEN \d+ ELSE \1\.visible_ms END\)/g;
/** Calls whose argument must never be a raw visible_ms: aggregates, ordered-set groups, LEAST / GREATEST. */
const VISIBLE_CALL =
  /\b(?:sum|avg|min|max|percentile_cont|percentile_disc|least|greatest)\s*\(|\bWITHIN\s+GROUP\s*\(/gi;
/**
 * The only allowed raw arguments: avg / p50 over the page stats `visible` CTE (alias `t`), whose
 * rows are already Σ credited visible_ms per page view.
 */
const OVER_CREDITED_CTE = new Set(['t.visible_ms', 'ORDER BY t.visible_ms']);

/** The argument text of every VISIBLE_CALL in `sql` that reads a raw (uncredited) visible_ms. */
function rawVisibleArguments(sql: string): string[] {
  const text = sql.replace(CREDITED_ROW, 'credited');
  const found: string[] = [];
  for (const match of text.matchAll(VISIBLE_CALL)) {
    const start = match.index + match[0].length;
    let depth = 1;
    let end = start;
    for (; end < text.length && depth > 0; end++) {
      if (text[end] === '(') depth++;
      else if (text[end] === ')') depth--;
    }
    const argument = text
      .slice(start, end - 1)
      .trim()
      .replace(/\s+/g, ' ');
    if (/\bvisible_ms\b/i.test(argument) && !OVER_CREDITED_CTE.has(argument)) found.push(argument);
  }
  return found;
}

describe('WebEventQueryRepository credited visible time (ADR 0017)', () => {
  /** Every statement of every method below, joined: the four places a shown visible time is summed. */
  async function statementsOf(read: (repo: WebEventQueryRepository) => Promise<unknown>) {
    const { exec, repo } = build();
    exec.rows = [{}];
    await read(repo);
    return exec.statements.map((statement) => statement.text).join(' ');
  }

  it('caps each page_time delta at all four sum sites (page view, visit, page stats, daily)', async () => {
    // pageViewVisibleMs (`pt`), via the person timeline and the visit steps.
    const timeline = await statementsOf((r) =>
      r.listUserTimeline(USER_KEY, FILTER, { after: null, limit: 3 }),
    );
    expect(timeline).toContain(`SELECT sum(${CAPPED('pt')})`);
    const session = await statementsOf((r) => r.getSession('app-id', SESSION_ID, FILTER));
    expect(session).toContain(`SELECT sum(${CAPPED('pt')})`);
    // sessionStatsStatement (`w`), the Visits list and the visit header.
    const visitStat = `coalesce(sum(${CAPPED('w')}) FILTER (WHERE w.event_type = 'page_time'), 0) AS visible_ms`;
    expect(await statementsOf((r) => r.listSessions(FILTER, { limit: 3, offset: 0 }))).toContain(
      visitStat,
    );
    expect(session).toContain(visitStat);
    // pageStatsStatement (`w`), the Pages list and one page.
    const pageStat = `SELECT w.page_view_id, sum(${CAPPED('w')}) AS visible_ms`;
    expect(await statementsOf((r) => r.listPageStats(FILTER, 5))).toContain(pageStat);
    expect(
      await statementsOf((r) => r.getPageDetail('/ebo-sales/stores/:id', FILTER, 'hour')),
    ).toContain(pageStat);
    // listUserDailyActivity (`h`), and the usual activity hours over the same union.
    expect(await statementsOf((r) => r.listUserDailyActivity(USER_KEY, FILTER))).toContain(
      `sum(${CAPPED('h')})`,
    );
    expect(await statementsOf((r) => r.listUserActivityPattern(USER_KEY, FILTER))).toContain(
      `sum(${CAPPED('h')})`,
    );
  });

  it('the raw-visible_ms guard catches every spelling and lets the credited shapes through', () => {
    for (const raw of [
      'SELECT sum(visible_ms) FROM t',
      'SELECT sum(w.visible_ms::int8) FROM t',
      'SELECT sum(coalesce(w.visible_ms, 0)) FROM t',
      'SELECT avg(w.visible_ms), max( w.visible_ms ) FROM t',
      'SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY w.visible_ms) FROM t',
      'SELECT sum(least(w.visible_ms, 60000)) FROM t',
    ]) {
      expect(rawVisibleArguments(raw), raw).not.toEqual([]);
    }
    expect(
      rawVisibleArguments(
        `SELECT coalesce(sum(${CAPPED('w')}) FILTER (WHERE w.event_type = 'page_time'), 0) AS visible_ms,
                avg(t.visible_ms), percentile_cont(0.5) WITHIN GROUP (ORDER BY t.visible_ms)`,
      ),
    ).toEqual([]);
  });

  it.each(Object.entries(READS))(
    '%s never aggregates a raw visible_ms and never uses LEAST on it (NULL would become the cap)',
    async (_name, read) => {
      expect(rawVisibleArguments(await statementsOf(read))).toEqual([]);
    },
  );
});
