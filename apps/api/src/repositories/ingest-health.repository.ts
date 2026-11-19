/**
 * READ side of the ingest bookkeeping for the Integration page: per app, the newest event of each
 * source, the window's ingest counters, the SDKs seen (with clock skew, the private-IP share of
 * server events and the coverage KPIs — identity, linking, release), the environment mix, the
 * rejection reasons, the PII detections, the SSO cookie outcomes and the secret keys that leaked
 * to the browser endpoint. Runs on the QUERY pool.
 *
 * INVARIANTS
 * - Window statements are bounded by `occurred_at >= from AND occurred_at < to` (partition
 *   pruning); counters and the hourly diagnostic tables by `bucket_hour`, aligned to the hour
 *   bucket that CONTAINS `from`.
 * - NOT environment-filtered (ADR 0008): Integration Health diagnoses staging wiring too, and
 *   shows the environment mix instead.
 * - Coverage predicates come ONLY from ./coverage-predicates.ts (one definition per KPI).
 * - The newest event per app is an index-backed backward scan (`idx_*_app_id_occurred_at`,
 *   ORDER BY … DESC LIMIT 1), so "never / stale" sees every retained partition cheaply.
 * - IP-class and source literals come from typed constants, never from input.
 * @see ../../migrations/0006_ingest_counters.sql
 * @see ../../migrations/0004_api_requests.sql (sdk, clock_skew_ms, ip_class)
 * @see ../../migrations/0005_web_events.sql (sdk, clock_skew_ms)
 * @see ../../migrations/0002_apps_and_api_keys.sql (traffic.apps, api_keys.exposed_at)
 * @see ../../migrations/0007_event_environment_and_client_context.sql (environment, web release)
 * @see ../../migrations/0010_ingest_rejections.sql
 * @see ../../migrations/0011_pii_detections.sql
 * @see ../../migrations/0012_sso_cookie_outcomes.sql
 */
import {
  INGEST_SOURCE_VALUES,
  MAX_REJECTION_ROWS_PER_APP,
  type IngestSource,
  type IpClass,
} from '@nexus/shared';
import type { Pool } from 'pg';

import type { Executor } from '../db/executor';
import { bucketExpr } from '../db/sql';
import type {
  AppHealthRow,
  EnvironmentMixRow,
  ExposedKeyRow,
  IngestCounterSumRow,
  IngestHealthRows,
  PiiDetectionRow,
  RejectionReasonRow,
  SdkHealthRow,
  SsoCookieOutcomeRow,
} from '../domain/rows';
import {
  IDENTIFIED_SQL,
  LINKABLE_SQL,
  LINKED_SQL,
  PAGE_VIEW_LINKED_SQL,
} from './coverage-predicates';

// ─── SQL fragments (trusted, frozen) ────────────────────────────────────────

const SERVER: IngestSource = 'server';
const BROWSER: IngestSource = 'browser';
/** IP classes that mean "the sender passed us a proxy hop, not the end user" (IP_CLASS_VALUES). */
const PROXY_IP_CLASSES: readonly IpClass[] = ['private', 'loopback'];
const UNKNOWN_IP_CLASS: IpClass = 'unknown';
const PROXY_IP_LIST = PROXY_IP_CLASSES.map((ipClass) => `'${ipClass}'`).join(', ');

/** Every app (slug order) + the newest stored event of each source. */
export const APP_HEALTH_SQL = `
SELECT a.id AS app_id, a.slug, a.display_name, a.is_active,
       (SELECT r.occurred_at FROM traffic.api_requests r
         WHERE r.app_id = a.id ORDER BY r.occurred_at DESC LIMIT 1) AS last_server_at,
       (SELECT w.occurred_at FROM traffic.web_events w
         WHERE w.app_id = a.id ORDER BY w.occurred_at DESC LIMIT 1) AS last_browser_at
  FROM traffic.apps a
 ORDER BY a.slug`;

/** $1 = from. Σ of the hourly counters since the bucket containing `from`. */
export const COUNTER_SUM_SQL = `
SELECT c.app_id, c.source,
       SUM(c.accepted)::int8 AS accepted, SUM(c.duplicates)::int8 AS duplicates,
       SUM(c.rejected)::int8 AS rejected, SUM(c.rate_limited)::int8 AS rate_limited
  FROM traffic.ingest_counters c
 WHERE c.bucket_hour >= ${bucketExpr('hour', '$1::timestamptz')}
 GROUP BY c.app_id, c.source`;

/**
 * Per (app, sdk) of one event table in [$1, $2): volume, newest event, median and worst clock
 * skew, identified events (IDENTIFIED_SQL), release coverage and the newest release; `ipColumns`
 * adds the private-IP counts (server table only — browser IPs are resolved by OUR proxy settings,
 * not the sender's) and `linkColumns` the linking counts (server table only — a browser event is
 * the session itself, so it is never "linkable").
 */
function sdkHealthSql(
  table: string,
  source: IngestSource,
  ipColumns: string,
  linkColumns: string,
): string {
  return `
SELECT e.app_id, '${source}' AS source, e.sdk, count(*)::int8 AS events,
       max(e.occurred_at) AS last_seen_at,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY e.clock_skew_ms) AS median_skew_ms,
       max(abs(e.clock_skew_ms))::int8 AS max_abs_skew_ms,
       ${ipColumns},
       count(*) FILTER (WHERE ${IDENTIFIED_SQL('e')})::int8 AS identified,
       ${linkColumns},
       count(*) FILTER (WHERE e.release IS NOT NULL)::int8 AS with_release,
       (array_agg(e.release ORDER BY e.occurred_at DESC) FILTER (WHERE e.release IS NOT NULL))[1]
         AS latest_release,
       max(e.occurred_at) FILTER (WHERE e.release IS NOT NULL) AS latest_release_at
  FROM ${table} e
 WHERE e.occurred_at >= $1 AND e.occurred_at < $2
 GROUP BY e.app_id, e.sdk`;
}

export const SERVER_SDK_HEALTH_SQL = sdkHealthSql(
  'traffic.api_requests',
  SERVER,
  `count(*) FILTER (WHERE e.ip_class IN (${PROXY_IP_LIST}))::int8 AS private_ip_events,
       count(*) FILTER (WHERE e.ip_class <> '${UNKNOWN_IP_CLASS}')::int8 AS classified_ip_events`,
  `count(*) FILTER (WHERE ${LINKABLE_SQL('e')})::int8 AS linkable,
       count(*) FILTER (WHERE ${LINKED_SQL('e')})::int8 AS linked,
       count(*) FILTER (WHERE ${PAGE_VIEW_LINKED_SQL('e')})::int8 AS page_view_linked`,
);

export const BROWSER_SDK_HEALTH_SQL = sdkHealthSql(
  'traffic.web_events',
  BROWSER,
  '0::int8 AS private_ip_events, 0::int8 AS classified_ip_events',
  '0::int8 AS linkable, 0::int8 AS linked, 0::int8 AS page_view_linked',
);

/**
 * $1 = from, $2 = to, $3 = INGEST_SOURCE_VALUES. Events per (app, source, environment) — Integration
 * Health is not env-filtered. Sources come in INGEST_SOURCE_VALUES order (server, browser), like
 * identityCoverage and releases, then busiest environment first.
 */
export const ENVIRONMENT_MIX_SQL = `
SELECT mix.app_id, mix.source, mix.environment, mix.events
  FROM (
    SELECT r.app_id, '${SERVER}' AS source, r.environment, count(*)::int8 AS events
      FROM traffic.api_requests r
     WHERE r.occurred_at >= $1 AND r.occurred_at < $2
     GROUP BY r.app_id, r.environment
    UNION ALL
    SELECT w.app_id, '${BROWSER}' AS source, w.environment, count(*)::int8 AS events
      FROM traffic.web_events w
     WHERE w.occurred_at >= $1 AND w.occurred_at < $2
     GROUP BY w.app_id, w.environment
  ) mix
 ORDER BY mix.app_id, array_position($3::text[], mix.source), mix.events DESC, mix.environment`;

/**
 * $1 = from, $2 = rows per app. Σ rejected per reason since the bucket containing `from`, the
 * busiest $2 per app (MAX_REJECTION_ROWS_PER_APP). Codes and normalised paths only — never text.
 */
export const REJECTION_REASONS_SQL = `
SELECT x.app_id, x.source, x.sdk, x.code, x.schema_path, x.rejected
  FROM (
    SELECT j.app_id, j.source, j.sdk, j.code, j.schema_path, SUM(j.rejected)::int8 AS rejected,
           row_number() OVER (
             PARTITION BY j.app_id
             ORDER BY SUM(j.rejected) DESC, j.source, j.code, j.sdk, j.schema_path
           ) AS position
      FROM traffic.ingest_rejections j
     WHERE j.bucket_hour >= ${bucketExpr('hour', '$1::timestamptz')}
     GROUP BY j.app_id, j.source, j.sdk, j.code, j.schema_path
  ) x
 WHERE x.position <= $2
 ORDER BY x.app_id, x.rejected DESC, x.source, x.code, x.sdk, x.schema_path`;

/** $1 = from. Σ PII detections per (app, source, field, kind) since the bucket containing `from`. */
export const PII_DETECTIONS_SQL = `
SELECT d.app_id, d.source, d.field, d.kind, SUM(d.detections)::int8 AS detections
  FROM traffic.pii_detections d
 WHERE d.bucket_hour >= ${bucketExpr('hour', '$1::timestamptz')}
 GROUP BY d.app_id, d.source, d.field, d.kind
 ORDER BY d.app_id, detections DESC, d.source, d.field, d.kind`;

/** $1 = from. Σ SSO cookie outcomes per (app, outcome, beacon origin) since the bucket containing `from`. */
export const SSO_COOKIE_OUTCOMES_SQL = `
SELECT o.app_id, o.outcome, o.beacon_origin, SUM(o.beacons)::int8 AS beacons
  FROM traffic.sso_cookie_outcomes o
 WHERE o.bucket_hour >= ${bucketExpr('hour', '$1::timestamptz')}
 GROUP BY o.app_id, o.outcome, o.beacon_origin
 ORDER BY o.app_id, beacons DESC, o.outcome, o.beacon_origin`;

/** $1 = now. Secret keys seen on the browser endpoint that still authenticate. */
export const EXPOSED_KEYS_SQL = `
SELECT k.app_id, k.id, k.key_prefix, k.label, k.exposed_at
  FROM traffic.api_keys k
 WHERE k.exposed_at IS NOT NULL
   AND k.revoked_at IS NULL
   AND (k.expires_at IS NULL OR k.expires_at > $1)
 ORDER BY k.exposed_at DESC, k.id`;

/** WHY: one repository for the Integration page's reads; the service assembles them per app. */
export class IngestHealthRepository {
  constructor(private readonly db: Pool) {}

  /**
   * The nine reads of the Integration page, run in parallel (independent, all read-only).
   * `from`/`to` bound the window statements; `to` is also "now" for key expiry.
   */
  async perApp(from: Date, to: Date, exec: Executor = this.db): Promise<IngestHealthRows> {
    const [
      apps,
      counters,
      serverSdks,
      browserSdks,
      exposedKeys,
      environmentMix,
      rejections,
      piiDetections,
      ssoOutcomes,
    ] = await Promise.all([
      exec.query<AppHealthRow>(APP_HEALTH_SQL),
      exec.query<IngestCounterSumRow>(COUNTER_SUM_SQL, [from]),
      exec.query<SdkHealthRow>(SERVER_SDK_HEALTH_SQL, [from, to]),
      exec.query<SdkHealthRow>(BROWSER_SDK_HEALTH_SQL, [from, to]),
      exec.query<ExposedKeyRow>(EXPOSED_KEYS_SQL, [to]),
      exec.query<EnvironmentMixRow>(ENVIRONMENT_MIX_SQL, [from, to, [...INGEST_SOURCE_VALUES]]),
      exec.query<RejectionReasonRow>(REJECTION_REASONS_SQL, [from, MAX_REJECTION_ROWS_PER_APP]),
      exec.query<PiiDetectionRow>(PII_DETECTIONS_SQL, [from]),
      exec.query<SsoCookieOutcomeRow>(SSO_COOKIE_OUTCOMES_SQL, [from]),
    ]);
    return {
      apps: apps.rows,
      counters: counters.rows,
      sdks: [...serverSdks.rows, ...browserSdks.rows],
      exposedKeys: exposedKeys.rows,
      environmentMix: environmentMix.rows,
      rejections: rejections.rows,
      piiDetections: piiDetections.rows,
      ssoOutcomes: ssoOutcomes.rows,
    };
  }
}
