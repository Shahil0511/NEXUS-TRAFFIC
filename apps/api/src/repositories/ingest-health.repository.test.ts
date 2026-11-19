/**
 * SQL-shape tests (no database) of the Integration page reads: bounded windows, index-backed
 * "newest event" scans, literal IP classes from the shared enum, and the parameters passed.
 */
import {
  IP_CLASS_VALUES,
  INGEST_SOURCE_VALUES,
  LINKABLE_DEVICE_CLASSES,
  MAX_REJECTION_ROWS_PER_APP,
} from '@nexus/shared';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  IDENTIFIED_SQL,
  LINKABLE_SQL,
  LINKED_SQL,
  PAGE_VIEW_LINKED_SQL,
} from './coverage-predicates';
import {
  APP_HEALTH_SQL,
  BROWSER_SDK_HEALTH_SQL,
  COUNTER_SUM_SQL,
  ENVIRONMENT_MIX_SQL,
  EXPOSED_KEYS_SQL,
  IngestHealthRepository,
  PII_DETECTIONS_SQL,
  REJECTION_REASONS_SQL,
  SERVER_SDK_HEALTH_SQL,
  SSO_COOKIE_OUTCOMES_SQL,
} from './ingest-health.repository';

const FROM = new Date('2026-09-30T10:00:00Z');
const TO = new Date('2026-10-01T10:00:00Z');

/** Records every statement; answers each with one row tagged by its statement. */
class RecordingExecutor {
  readonly statements: Array<{ text: string; values: unknown[] }> = [];
  async query(text: string, values: unknown[] = []) {
    this.statements.push({ text, values });
    return {
      rows: [{ app_id: 'a', source: text === BROWSER_SDK_HEALTH_SQL ? 'browser' : 'server' }],
    };
  }
}

const squash = (sql: string) => sql.replace(/\s+/g, ' ').trim();

describe('IngestHealthRepository.perApp', () => {
  it('runs the nine reads with the window bounds, now for key expiry', async () => {
    const exec = new RecordingExecutor();
    const repo = new IngestHealthRepository(exec as unknown as Pool);

    const rows = await repo.perApp(FROM, TO);

    expect(exec.statements.map((s) => s.text)).toEqual([
      APP_HEALTH_SQL,
      COUNTER_SUM_SQL,
      SERVER_SDK_HEALTH_SQL,
      BROWSER_SDK_HEALTH_SQL,
      EXPOSED_KEYS_SQL,
      ENVIRONMENT_MIX_SQL,
      REJECTION_REASONS_SQL,
      PII_DETECTIONS_SQL,
      SSO_COOKIE_OUTCOMES_SQL,
    ]);
    expect(exec.statements.map((s) => s.values)).toEqual([
      [],
      [FROM],
      [FROM, TO],
      [FROM, TO],
      [TO],
      [FROM, TO, [...INGEST_SOURCE_VALUES]],
      [FROM, MAX_REJECTION_ROWS_PER_APP],
      [FROM],
      [FROM],
    ]);
    expect(rows.apps).toHaveLength(1);
    expect(rows.counters).toHaveLength(1);
    // server + browser SDK rows are concatenated into ONE list
    expect(rows.sdks.map((r) => r.source)).toEqual(['server', 'browser']);
    expect(rows.exposedKeys).toHaveLength(1);
    expect(rows.environmentMix).toHaveLength(1);
    expect(rows.rejections).toHaveLength(1);
    expect(rows.piiDetections).toHaveLength(1);
    expect(rows.ssoOutcomes).toHaveLength(1);
  });
});

describe('the statements', () => {
  it('finds the newest event per source with an index-backed DESC LIMIT 1 scan', () => {
    const sql = squash(APP_HEALTH_SQL);
    expect(sql).toContain(
      'FROM traffic.api_requests r WHERE r.app_id = a.id ORDER BY r.occurred_at DESC LIMIT 1',
    );
    expect(sql).toContain(
      'FROM traffic.web_events w WHERE w.app_id = a.id ORDER BY w.occurred_at DESC LIMIT 1',
    );
    expect(sql).toMatch(/ORDER BY a\.slug$/);
  });

  it('bounds both SDK statements by occurred_at (partition pruning) and groups by app + sdk', () => {
    for (const sql of [SERVER_SDK_HEALTH_SQL, BROWSER_SDK_HEALTH_SQL].map(squash)) {
      expect(sql).toContain('WHERE e.occurred_at >= $1 AND e.occurred_at < $2');
      expect(sql).toContain('GROUP BY e.app_id, e.sdk');
      expect(sql).toContain('percentile_cont(0.5) WITHIN GROUP (ORDER BY e.clock_skew_ms)');
    }
    expect(squash(SERVER_SDK_HEALTH_SQL)).toContain('FROM traffic.api_requests e');
    expect(squash(BROWSER_SDK_HEALTH_SQL)).toContain('FROM traffic.web_events e');
  });

  it('counts private IPs on SERVER events only, with literals from IP_CLASS_VALUES', () => {
    const server = squash(SERVER_SDK_HEALTH_SQL);
    expect(server).toContain("e.ip_class IN ('private', 'loopback')");
    expect(server).toContain("e.ip_class <> 'unknown'");
    for (const literal of server.match(/'([a-z]+)'/g) ?? []) {
      const value = literal.slice(1, -1);
      expect([...IP_CLASS_VALUES, ...LINKABLE_DEVICE_CLASSES, 'server', 'http']).toContain(value);
    }
    expect(squash(BROWSER_SDK_HEALTH_SQL)).toContain('0::int8 AS private_ip_events');
    expect(BROWSER_SDK_HEALTH_SQL).not.toContain('ip_class');
  });

  it('sums counters from the hour bucket CONTAINING `from` (IST-aligned date_bin)', () => {
    const sql = squash(COUNTER_SUM_SQL);
    expect(sql).toContain("c.bucket_hour >= date_bin('1 hour', $1::timestamptz");
    expect(sql).toContain('GROUP BY c.app_id, c.source');
  });

  it('lists only exposed keys that still authenticate', () => {
    const sql = squash(EXPOSED_KEYS_SQL);
    expect(sql).toContain('k.exposed_at IS NOT NULL');
    expect(sql).toContain('k.revoked_at IS NULL');
    expect(sql).toContain('(k.expires_at IS NULL OR k.expires_at > $1)');
    expect(sql).not.toContain('key_hash');
  });
});

describe('the coverage columns', () => {
  it('use the ONE definition of each KPI (coverage-predicates.ts)', () => {
    const server = squash(SERVER_SDK_HEALTH_SQL);
    expect(server).toContain(`count(*) FILTER (WHERE ${IDENTIFIED_SQL('e')})::int8 AS identified`);
    expect(server).toContain(`count(*) FILTER (WHERE ${LINKABLE_SQL('e')})::int8 AS linkable`);
    expect(server).toContain(`count(*) FILTER (WHERE ${LINKED_SQL('e')})::int8 AS linked`);
    expect(server).toContain(
      `count(*) FILTER (WHERE ${PAGE_VIEW_LINKED_SQL('e')})::int8 AS page_view_linked`,
    );
  });

  it('browser rows are never linkable (constant 0) but do report identity and release', () => {
    const browser = squash(BROWSER_SDK_HEALTH_SQL);
    expect(browser).toContain(
      '0::int8 AS linkable, 0::int8 AS linked, 0::int8 AS page_view_linked',
    );
    expect(browser).toContain(`FILTER (WHERE ${IDENTIFIED_SQL('e')})::int8 AS identified`);
    for (const sql of [squash(SERVER_SDK_HEALTH_SQL), browser]) {
      expect(sql).toContain('FILTER (WHERE e.release IS NOT NULL)::int8 AS with_release');
      expect(sql).toContain('AS latest_release,');
      expect(sql).toContain('AS latest_release_at');
    }
  });
});

describe('the diagnostic statements', () => {
  it('environment mix: both tables, window-bounded, NOT env-filtered', () => {
    const sql = squash(ENVIRONMENT_MIX_SQL);
    expect(sql).toContain(
      'FROM traffic.api_requests r WHERE r.occurred_at >= $1 AND r.occurred_at < $2',
    );
    expect(sql).toContain(
      'FROM traffic.web_events w WHERE w.occurred_at >= $1 AND w.occurred_at < $2',
    );
    expect(sql).not.toContain('ANY(');
    expect(sql).toContain('ORDER BY mix.app_id, array_position($3::text[], mix.source)');
  });

  it.each([
    ['rejections', REJECTION_REASONS_SQL, 'j'],
    ['pii detections', PII_DETECTIONS_SQL, 'd'],
    ['sso outcomes', SSO_COOKIE_OUTCOMES_SQL, 'o'],
  ])('%s are bounded by the hour bucket CONTAINING `from`', (_name, statement, alias) => {
    expect(squash(statement)).toContain(
      `${alias}.bucket_hour >= date_bin('1 hour', $1::timestamptz`,
    );
  });

  it('rejections: the busiest $2 reasons per app, codes and paths only', () => {
    const sql = squash(REJECTION_REASONS_SQL);
    expect(sql).toContain('row_number() OVER ( PARTITION BY j.app_id');
    expect(sql).toContain('WHERE x.position <= $2');
    expect(sql).not.toMatch(/message/i);
  });
});
