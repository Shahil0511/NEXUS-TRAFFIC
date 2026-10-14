/**
 * SQL-shape tests (no database): the invariants the DB suite cannot see from results alone —
 * literal partial-index predicates, bounded windows, whitelisted ORDER BY.
 * Results are covered by test/db/analytics-queries.integration.test.ts.
 */
import { STATUS_CLASS_VALUES } from '@nexus/shared';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { likeContains, ParamList } from '../db/sql';
import type { EndpointListOptions, FailureFilter, TrafficFilter } from '../domain/filters';
import {
  ApiRequestQueryRepository,
  errorCodeCondition,
  FAILURE_PREDICATES,
  scopeConditions,
} from './api-request-query.repository';

const FILTER: TrafficFilter = {
  from: new Date('2026-10-01T00:00:00Z'),
  to: new Date('2026-10-02T00:00:00Z'),
};
/** An app error code; must only ever reach SQL as a bound value. */
const CODE = 'UPSTREAM_TIMEOUT';

/** Records every statement; answers with no rows. */
class RecordingExecutor {
  readonly statements: Array<{ text: string; values: unknown[] }> = [];
  async query(text: string, values: unknown[] = []) {
    this.statements.push({ text, values });
    return { rows: [] };
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
