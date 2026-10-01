/**
 * SQL-shape tests (no database): the invariants the DB suite cannot see from results alone —
 * literal partial-index predicates, bounded windows, whitelisted ORDER BY.
 * Results are covered by test/db/analytics-queries.integration.test.ts.
 */
import { STATUS_CLASS_VALUES } from '@nexus/shared';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { likeContains, ParamList } from '../db/sql';
import type { EndpointListOptions, TrafficFilter } from '../domain/filters';
import {
  ApiRequestQueryRepository,
  FAILURE_PREDICATES,
  scopeConditions,
} from './api-request-query.repository';

const FILTER: TrafficFilter = {
  from: new Date('2026-10-01T00:00:00Z'),
  to: new Date('2026-10-02T00:00:00Z'),
};

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
