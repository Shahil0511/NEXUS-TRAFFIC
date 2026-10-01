/**
 * WRITE side of `traffic.api_requests`: one multi-row INSERT per ingest batch.
 *
 * INVARIANTS
 * - `received_at` is NEVER app-supplied: it is omitted from the column list (DB default now()).
 * - Idempotent: ON CONFLICT (occurred_at, event_id) DO NOTHING; returns only the inserted event ids,
 *   so the service reports `duplicates = sent - inserted`.
 * @see ../../migrations/0004_api_requests.sql
 */
import type { Pool } from 'pg';

import type { Executor } from '../db/executor';
import type { ApiRequestInsert } from '../domain/inserts';

/** One column of the unnest INSERT: its name, its SQL array type and how to read it from a row. */
interface ColumnSpec {
  column: string;
  arrayType: string;
  value: (row: ApiRequestInsert) => unknown;
}

/**
 * THE column list (order = unnest argument order). Every ApiRequestInsert field appears once;
 * received_at is deliberately absent.
 */
const COLUMNS: readonly ColumnSpec[] = [
  { column: 'occurred_at', arrayType: 'timestamptz[]', value: (r) => r.occurredAt },
  { column: 'event_id', arrayType: 'uuid[]', value: (r) => r.eventId },
  { column: 'clock_skew_ms', arrayType: 'int8[]', value: (r) => r.clockSkewMs },
  { column: 'app_id', arrayType: 'uuid[]', value: (r) => r.appId },
  { column: 'endpoint_id', arrayType: 'uuid[]', value: (r) => r.endpointId },
  { column: 'kind', arrayType: 'text[]', value: (r) => r.kind },
  { column: 'method', arrayType: 'text[]', value: (r) => r.method },
  { column: 'route_template', arrayType: 'text[]', value: (r) => r.routeTemplate },
  { column: 'path', arrayType: 'text[]', value: (r) => r.path },
  { column: 'status_code', arrayType: 'int2[]', value: (r) => r.statusCode },
  { column: 'duration_ms', arrayType: 'float4[]', value: (r) => r.durationMs },
  { column: 'request_bytes', arrayType: 'int8[]', value: (r) => r.requestBytes },
  { column: 'response_bytes', arrayType: 'int8[]', value: (r) => r.responseBytes },
  { column: 'error_code', arrayType: 'text[]', value: (r) => r.errorCode },
  { column: 'release', arrayType: 'text[]', value: (r) => r.release },
  { column: 'request_id', arrayType: 'text[]', value: (r) => r.requestId },
  { column: 'session_id', arrayType: 'uuid[]', value: (r) => r.sessionId },
  { column: 'page_view_id', arrayType: 'uuid[]', value: (r) => r.pageViewId },
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
export const INSERT_API_REQUESTS_SQL = `INSERT INTO traffic.api_requests (${COLUMNS.map((c) => c.column).join(', ')})
SELECT * FROM unnest(${COLUMNS.map((c, i) => `$${i + 1}::${c.arrayType}`).join(', ')})
ON CONFLICT (occurred_at, event_id) DO NOTHING
RETURNING event_id`;

/** Column-major parameters: one array per column, each with one element per row. */
export function toColumnArrays(rows: readonly ApiRequestInsert[]): unknown[][] {
  return COLUMNS.map((spec) => rows.map((row) => spec.value(row)));
}

export class ApiRequestIngestRepository {
  constructor(private readonly db: Pool) {}

  /** Inserts the batch with a single `INSERT … SELECT FROM unnest(...)`; returns inserted event ids. */
  async insertBatch(rows: ApiRequestInsert[], exec: Executor = this.db): Promise<string[]> {
    if (rows.length === 0) return [];
    const result = await exec.query<{ event_id: string }>(INSERT_API_REQUESTS_SQL, toColumnArrays(rows));
    return result.rows.map((r) => r.event_id);
  }
}
