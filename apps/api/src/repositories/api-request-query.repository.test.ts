/**
 * SQL-shape tests (no database): the invariants the DB suite cannot see from results alone —
 * literal partial-index predicates, bounded windows, whitelisted ORDER BY.
 * Results are covered by test/db/analytics-queries.integration.test.ts.
 */
import { SERVER_BREAKDOWN_DIMENSION_VALUES, STATUS_CLASS_VALUES } from '@nexus/shared';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { likeContains, ParamList } from '../db/sql';
import type { EndpointListOptions, FailureFilter, TrafficFilter } from '../domain/filters';
import {
  ApiRequestQueryRepository,
  environmentConditions,
  errorCodeCondition,
  FAILURE_PREDICATES,
  scopeConditions,
  SERVER_BREAKDOWN_COLUMNS,
} from './api-request-query.repository';
import { IDENTIFIED_SQL, LINKABLE_SQL, LINKED_SQL } from './coverage-predicates';

const FILTER: TrafficFilter = {
  from: new Date('2026-10-01T00:00:00Z'),
  to: new Date('2026-10-02T00:00:00Z'),
  environments: null,
};
/** An app error code; must only ever reach SQL as a bound value. */
const CODE = 'UPSTREAM_TIMEOUT';

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
  const repo = new ApiRequestQueryRepository(exec as unknown as Pool);
  return { exec, repo };
}

const LIST_OPTIONS: EndpointListOptions = { sort: 'calls', dir: 'desc', limit: 51, offset: 0 };

describe('FAILURE_PREDICATES', () => {
  it.each(STATUS_CLASS_VALUES.map((c) => [c] as const))(
    '%s contains the partial-index predicate verbatim and no placeholder',
    (statusClass) => {
      expect(FAILURE_PREDICATES[statusClass]).toContain('status_code >= 400');
      expect(FAILURE_PREDICATES[statusClass]).not.toMatch(/\$\d/);
    },
  );

  it('is frozen', () => {
    expect(Object.isFrozen(FAILURE_PREDICATES)).toBe(true);
  });
});

describe('scopeConditions', () => {
  it('always bounds occurred_at on both sides and adds app / endpoint only when given', () => {
    const params = new ParamList();
    expect(scopeConditions(FILTER, params)).toEqual(['r.occurred_at >= $1', 'r.occurred_at < $2']);
    const scoped = new ParamList();
    expect(scopeConditions({ ...FILTER, appId: 'a', endpointId: 'e' }, scoped)).toEqual([
      'r.occurred_at >= $1',
      'r.occurred_at < $2',
      'r.app_id = $3',
      'r.endpoint_id = $4',
    ]);
    expect(scoped.values).toEqual([FILTER.from, FILTER.to, 'a', 'e']);
  });

  it('never scopes by error code (a code narrows failures only)', () => {
    const params = new ParamList();
    const coded: FailureFilter = { ...FILTER, errorCode: CODE };
    expect(scopeConditions(coded, params).join(' ')).not.toContain('error_code');
    expect(params.values).not.toContain(CODE);
  });
});

describe('errorCodeCondition', () => {
  it('binds the code as a parameter, and is null without one', () => {
    const params = new ParamList();
    params.add('first');
    expect(errorCodeCondition({ ...FILTER, errorCode: CODE }, params)).toBe('r.error_code = $2');
    expect(params.values).toEqual(['first', CODE]);
    expect(errorCodeCondition(FILTER, new ParamList())).toBeNull();
  });
});

describe('ApiRequestQueryRepository SQL with an error code', () => {
  const CODED: FailureFilter = { ...FILTER, errorCode: CODE };

  /** The statement whose text contains `marker`. */
  function statementWith(exec: RecordingExecutor, marker: string) {
    const statement = exec.statements.find((s) => s.text.includes(marker));
    expect(statement, marker).toBeDefined();
    return statement!;
  }

  it('summarizeErrors binds the code (never interpolates it) in every failure statement', async () => {
    const { exec, repo } = build();
    await repo.summarizeErrors(CODED, 'hour');
    for (const statement of exec.statements) {
      expect(statement.text).not.toContain(CODE);
      expect(statement.values).toContain(CODE);
      expect(statement.text).toMatch(/r\.error_code = \$\d+/);
    }
  });

  it('top failing endpoints count calls over ALL requests; the code only narrows 4xx/5xx and HAVING', async () => {
    const { exec, repo } = build();
    await repo.summarizeErrors(CODED, 'hour');
    const stats = statementWith(exec, 'WITH stats AS');
    const where = /WHERE (r\.occurred_at.*?)\s+GROUP BY/s.exec(stats.text)?.[1] ?? '';
    expect(where).toContain('r.occurred_at');
    expect(where).not.toContain('error_code');
    expect(stats.text).toContain('count(*) AS calls');
    const n = stats.values.indexOf(CODE) + 1;
    expect(stats.text).toContain(`${FAILURE_PREDICATES['4xx']} AND r.error_code = $${n}`);
    expect(stats.text).toContain(`${FAILURE_PREDICATES['5xx']} AND r.error_code = $${n}`);
    expect(stats.text).toContain(
      `HAVING count(*) FILTER (WHERE ${FAILURE_PREDICATES.all} AND r.error_code = $${n}) > 0`,
    );
  });

  it('the errors series keeps `requests` over all calls and narrows only the failure FILTERs', async () => {
    const { exec, repo } = build();
    await repo.timeseries(CODED, 'hour');
    const [series] = exec.statements;
    expect(series?.text).toMatch(/count\(\*\) AS requests/);
    const where = /WHERE (r\.occurred_at.*?)\s+GROUP BY/s.exec(series?.text ?? '')?.[1] ?? '';
    expect(where).toContain('r.occurred_at');
    expect(where).not.toContain('error_code');
    expect(series?.text).toContain(`${FAILURE_PREDICATES['4xx']} AND r.error_code = $3`);
  });

  it('listFailures ANDs the bound code into its WHERE, after the literal predicate', async () => {
    const { exec, repo } = build();
    await repo.listFailures(CODED, { statusClass: 'all', after: null, limit: 3 });
    expect(exec.statements[0]?.text).toContain(`${FAILURE_PREDICATES.all} AND r.error_code = $3`);
    expect(exec.statements[0]?.values[2]).toBe(CODE);
  });
});

describe('ApiRequestQueryRepository SQL', () => {
  it('listFailures emits the literal predicate of the status class and a keyset row comparison', async () => {
    const { exec, repo } = build();
    await repo.listFailures(FILTER, {
      statusClass: '5xx',
      after: {
        occurredAt: '2026-10-01T12:00:00.000001Z',
        eventId: '44444444-4444-4444-8444-444444444444',
      },
      limit: 3,
    });
    const [statement] = exec.statements;
    expect(statement?.text).toContain(FAILURE_PREDICATES['5xx']);
    expect(statement?.text).toContain('(r.occurred_at, r.event_id) < ($3::timestamptz, $4::uuid)');
    expect(statement?.text).toContain('ORDER BY r.occurred_at DESC, r.event_id DESC');
    expect(statement?.values).not.toContain(400);
    expect(statement?.values).toContain('2026-10-01T12:00:00.000001Z');
    expect(statement?.text).toContain(`AS occurred_at_key`);
  });

  it('listEndpointStats orders by the whitelisted expression with a stable tie-breaker', async () => {
    const { exec, repo } = build();
    await repo.listEndpointStats(FILTER, { ...LIST_OPTIONS, sort: 'p95', dir: 'asc' });
    expect(exec.statements[0]?.text).toContain(
      'ORDER BY s.p95_ms ASC NULLS LAST, s.endpoint_id ASC',
    );
    expect(exec.statements[0]?.text).toContain("FILTER (WHERE r.kind = 'http')");
  });

  it('listEndpointStats refuses a sort key outside the whitelist', async () => {
    const { repo } = build();
    const injected = {
      ...LIST_OPTIONS,
      sort: 'calls; DROP TABLE x',
    } as unknown as EndpointListOptions;
    await expect(repo.listEndpointStats(FILTER, injected)).rejects.toThrow(/not whitelisted/);
  });

  it('search is a parameter with LIKE wildcards escaped', async () => {
    const { exec, repo } = build();
    await repo.listEndpointStats(FILTER, { ...LIST_OPTIONS, search: '50%_off' });
    expect(exec.statements[0]?.text).toContain('r.route_template ILIKE $3');
    expect(exec.statements[0]?.values[2]).toBe(likeContains('50%_off'));
    expect(likeContains('50%_off')).toBe('%50\\%\\_off%');
  });

  it('getEndpointDetail stops after the stats query when the endpoint has no rows', async () => {
    const { exec, repo } = build();
    expect(await repo.getEndpointDetail('e', FILTER, 'hour')).toBeNull();
    expect(exec.statements).toHaveLength(1);
  });
});

// ─── Environment filter (ADR 0008) ──────────────────────────────────────────

describe('environmentConditions / scopeConditions', () => {
  it('adds ONE bound text[] predicate when the filter keeps environments, nothing for null', () => {
    const params = new ParamList();
    expect(environmentConditions('w', { ...FILTER, environments: ['prod'] }, params)).toEqual([
      'w.environment = ANY($1::text[])',
    ]);
    expect(params.values).toEqual([['prod']]);
    expect(environmentConditions('w', FILTER, new ParamList())).toEqual([]);
  });

  it('scopeConditions ends with the environment predicate', () => {
    const params = new ParamList();
    const conditions = scopeConditions({ ...FILTER, environments: ['staging', 'dev'] }, params);
    expect(conditions.at(-1)).toBe('r.environment = ANY($3::text[])');
    expect(params.values.at(-1)).toEqual(['staging', 'dev']);
  });
});

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

const STAGING: FailureFilter = { ...FILTER, environments: ['staging'], errorCode: CODE };
const READS: Record<string, (repo: ApiRequestQueryRepository) => Promise<unknown>> = {
  summarizeTraffic: (r) => r.summarizeTraffic(STAGING),
  summarizeTrafficByApp: (r) => r.summarizeTrafficByApp(STAGING),
  timeseries: (r) => r.timeseries(STAGING, 'hour'),
  listEndpointStats: (r) => r.listEndpointStats(STAGING, LIST_OPTIONS),
  getEndpointDetail: (r) => r.getEndpointDetail('e', STAGING, 'hour'),
  summarizeErrors: (r) => r.summarizeErrors(STAGING, 'hour'),
  listFailures: (r) => r.listFailures(STAGING, { statusClass: 'all', after: null, limit: 3 }),
  listUserTopEndpoints: (r) => r.listUserTopEndpoints(Buffer.alloc(32), STAGING, 5),
  listPageApiCalls: (r) => r.listPageApiCalls('/ebo-sales/stores', STAGING, 5),
  countByDimension: (r) => r.countByDimension('os', STAGING, 5),
};
const PRIVATE_METHODS = [
  'countUsers',
  'listTopUsers',
  'queryEndpointStats',
  'countFailures',
  'countByErrorCode',
  'countByStatus',
  'listSlowest',
];

describe('ApiRequestQueryRepository environment filter', () => {
  it('the READS table covers every method (a new read must be added here)', () => {
    const methods = Object.getOwnPropertyNames(ApiRequestQueryRepository.prototype).filter(
      (name) => name !== 'constructor' && !PRIVATE_METHODS.includes(name),
    );
    expect(methods.sort()).toEqual(Object.keys(READS).sort());
  });

  it.each(Object.entries(READS))(
    '%s filters EVERY table of EVERY statement by environment',
    async (_name, read) => {
      const exec = new RecordingExecutor();
      exec.rows = [{}];
      await read(new ApiRequestQueryRepository(exec as unknown as Pool));
      expect(exec.statements.length).toBeGreaterThan(0);
      for (const { text, values } of exec.statements) {
        expectEveryTableEnvFiltered(text);
        expect(values).toContainEqual(['staging']);
      }
    },
  );
});

describe('ApiRequestQueryRepository coverage and breakdown', () => {
  it('summarizeTrafficByApp counts identified / linkable / linked with the shared predicates', async () => {
    const { exec, repo } = build();
    await repo.summarizeTrafficByApp(FILTER);
    const text = exec.statements[0]?.text ?? '';
    expect(text).toContain(`FILTER (WHERE ${IDENTIFIED_SQL('r')}) AS identified`);
    expect(text).toContain(`FILTER (WHERE ${LINKABLE_SQL('r')}) AS linkable`);
    expect(text).toContain(`FILTER (WHERE ${LINKED_SQL('r')}) AS linked`);
  });

  it('SERVER_BREAKDOWN_COLUMNS whitelists exactly the server dimensions (frozen)', () => {
    expect(Object.keys(SERVER_BREAKDOWN_COLUMNS).sort()).toEqual(
      [...SERVER_BREAKDOWN_DIMENSION_VALUES].sort(),
    );
    expect(Object.isFrozen(SERVER_BREAKDOWN_COLUMNS)).toBe(true);
  });

  it('countByDimension groups by the whitelisted column over every call in scope', async () => {
    const { exec, repo } = build();
    await repo.countByDimension('device', FILTER, 4);
    const [statement] = exec.statements;
    expect(statement?.text).toContain('SELECT r.ua_device AS value');
    expect(statement?.text).toContain('GROUP BY r.ua_device');
    expect(statement?.text).toContain('sum(count(*)) OVER ()::int8 AS total');
    expect(statement?.values).toEqual([FILTER.from, FILTER.to, 4]);
  });
});
