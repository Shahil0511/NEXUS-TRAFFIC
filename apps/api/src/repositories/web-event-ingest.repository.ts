/**
 * WRITE side of `traffic.web_events`: one multi-row INSERT per browser beacon.
 *
 * INVARIANTS (same as ApiRequestIngestRepository)
 * - `received_at` is NEVER app-supplied: it is omitted from the column list (DB default now()).
 * - Idempotent: ON CONFLICT (occurred_at, event_id) DO NOTHING; returns only the inserted event ids,
 *   so the service reports `duplicates = sent - inserted`.
 * @see ../../migrations/0005_web_events.sql
 */
import type { Pool } from 'pg';

import type { Executor } from '../db/executor';
import type { WebEventInsert } from '../domain/inserts';

/** One column of the unnest INSERT: its name, its SQL array type and how to read it from a row. */
interface ColumnSpec {
  column: string;
  arrayType: string;
  value: (row: WebEventInsert) => unknown;
}

/**
 * THE column list (order = unnest argument order). Every WebEventInsert field appears once;
 * received_at is deliberately absent.
 */
const COLUMNS: readonly ColumnSpec[] = [
  { column: 'occurred_at', arrayType: 'timestamptz[]', value: (r) => r.occurredAt },
  { column: 'event_id', arrayType: 'uuid[]', value: (r) => r.eventId },
  { column: 'clock_skew_ms', arrayType: 'int8[]', value: (r) => r.clockSkewMs },
  { column: 'app_id', arrayType: 'uuid[]', value: (r) => r.appId },
  { column: 'session_id', arrayType: 'uuid[]', value: (r) => r.sessionId },
  { column: 'anonymous_id', arrayType: 'uuid[]', value: (r) => r.anonymousId },
  { column: 'seq', arrayType: 'int4[]', value: (r) => r.seq },
  { column: 'event_type', arrayType: 'text[]', value: (r) => r.eventType },
  { column: 'path', arrayType: 'text[]', value: (r) => r.path },
  { column: 'path_template', arrayType: 'text[]', value: (r) => r.pathTemplate },
  { column: 'referrer_path', arrayType: 'text[]', value: (r) => r.referrerPath },
  { column: 'referrer_host', arrayType: 'text[]', value: (r) => r.referrerHost },
  { column: 'nav', arrayType: 'text[]', value: (r) => r.nav },
  { column: 'page_view_id', arrayType: 'uuid[]', value: (r) => r.pageViewId },
  { column: 'visible_ms', arrayType: 'int4[]', value: (r) => r.visibleMs },
  { column: 'is_final', arrayType: 'bool[]', value: (r) => r.isFinal },
  { column: 'time_reason', arrayType: 'text[]', value: (r) => r.timeReason },
  { column: 'tool', arrayType: 'text[]', value: (r) => r.tool },
  { column: 'action', arrayType: 'text[]', value: (r) => r.action },
  { column: 'label', arrayType: 'text[]', value: (r) => r.label },
  { column: 'value', arrayType: 'numeric[]', value: (r) => r.value },
  { column: 'name', arrayType: 'text[]', value: (r) => r.name },
  // Serialized here (not by pg's array encoder) so a jsonb[] element is always one JSON document.
  { column: 'props', arrayType: 'jsonb[]', value: (r) => (r.props ? JSON.stringify(r.props) : null) },
  { column: 'user_email', arrayType: 'text[]', value: (r) => r.userEmail },
  { column: 'user_key', arrayType: 'bytea[]', value: (r) => r.userKey },
  { column: 'claimed_email', arrayType: 'text[]', value: (r) => r.claimedEmail },
  { column: 'identity_source', arrayType: 'text[]', value: (r) => r.identitySource },
  { column: 'ip', arrayType: 'inet[]', value: (r) => r.ip },
  { column: 'ip_hash', arrayType: 'bytea[]', value: (r) => r.ipHash },
  { column: 'ip_class', arrayType: 'text[]', value: (r) => r.ipClass },
  { column: 'geo_country', arrayType: 'text[]', value: (r) => r.geoCountry },
  { column: 'geo_region', arrayType: 'text[]', value: (r) => r.geoRegion },
  { column: 'geo_city', arrayType: 'text[]', value: (r) => r.geoCity },
  { column: 'geo_lat', arrayType: 'float4[]', value: (r) => r.geoLat },
  { column: 'geo_lon', arrayType: 'float4[]', value: (r) => r.geoLon },
  { column: 'ua_browser', arrayType: 'text[]', value: (r) => r.uaBrowser },
  { column: 'ua_os', arrayType: 'text[]', value: (r) => r.uaOs },
  { column: 'ua_device', arrayType: 'text[]', value: (r) => r.uaDevice },
  { column: 'sdk', arrayType: 'text[]', value: (r) => r.sdk },
];

/** Built once: INSERT INTO … SELECT * FROM unnest($1::timestamptz[], …) ON CONFLICT DO NOTHING. */
export const INSERT_WEB_EVENTS_SQL = `INSERT INTO traffic.web_events (${COLUMNS.map((c) => c.column).join(', ')})
SELECT * FROM unnest(${COLUMNS.map((c, i) => `$${i + 1}::${c.arrayType}`).join(', ')})
ON CONFLICT (occurred_at, event_id) DO NOTHING
RETURNING event_id`;

/** Column-major parameters: one array per column, each with one element per row. */
export function toWebEventColumnArrays(rows: readonly WebEventInsert[]): unknown[][] {
  return COLUMNS.map((spec) => rows.map((row) => spec.value(row)));
}

export class WebEventIngestRepository {
  constructor(private readonly db: Pool) {}

  /** Inserts the batch with a single `INSERT … SELECT FROM unnest(...)`; returns inserted event ids. */
  async insertBatch(rows: WebEventInsert[], exec: Executor = this.db): Promise<string[]> {
    if (rows.length === 0) return [];
    const result = await exec.query<{ event_id: string }>(INSERT_WEB_EVENTS_SQL, toWebEventColumnArrays(rows));
    return result.rows.map((r) => r.event_id);
  }
}
