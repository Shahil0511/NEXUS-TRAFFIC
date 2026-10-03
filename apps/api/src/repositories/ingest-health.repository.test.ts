/**
 * SQL-shape tests (no database) of the Integration page reads: bounded windows, index-backed
 * "newest event" scans, literal IP classes from the shared enum, and the parameters passed.
 */
import { IP_CLASS_VALUES } from '@nexus/shared';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  APP_HEALTH_SQL,
  BROWSER_SDK_HEALTH_SQL,
  COUNTER_SUM_SQL,
  EXPOSED_KEYS_SQL,
  IngestHealthRepository,
  SERVER_SDK_HEALTH_SQL,
} from './ingest-health.repository';

const FROM = new Date('2026-09-30T10:00:00Z');
const TO = new Date('2026-10-01T10:00:00Z');

/** Records every statement; answers each with one row tagged by its statement. */
class RecordingExecutor {
  readonly statements: Array<{ text: string; values: unknown[] }> = [];
  async query(text: string, values: unknown[] = []) {
    this.statements.push({ text, values });
    return { rows: [{ app_id: 'a', source: text === BROWSER_SDK_HEALTH_SQL ? 'browser' : 'server' }] };
  }
}

const squash = (sql: string) => sql.replace(/\s+/g, ' ').trim();

describe('IngestHealthRepository.perApp', () => {
  it('runs the five reads with the window bounds, now for key expiry', async () => {
    const exec = new RecordingExecutor();
    const repo = new IngestHealthRepository(exec as unknown as Pool);

    const rows = await repo.perApp(FROM, TO);

    expect(exec.statements.map((s) => s.text)).toEqual([
      APP_HEALTH_SQL,
      COUNTER_SUM_SQL,
      SERVER_SDK_HEALTH_SQL,
      BROWSER_SDK_HEALTH_SQL,
      EXPOSED_KEYS_SQL,
    ]);
    expect(exec.statements.map((s) => s.values)).toEqual([[], [FROM], [FROM, TO], [FROM, TO], [TO]]);
    expect(rows.apps).toHaveLength(1);
    expect(rows.counters).toHaveLength(1);
    // server + browser SDK rows are concatenated into ONE list
    expect(rows.sdks.map((r) => r.source)).toEqual(['server', 'browser']);
    expect(rows.exposedKeys).toHaveLength(1);
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
      expect([...IP_CLASS_VALUES, 'server']).toContain(value);
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
