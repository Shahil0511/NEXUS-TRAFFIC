/**
 * READ side of the ingest bookkeeping for the Integration page: per app, the newest event of each
 * source, the window's ingest counters, the SDKs seen (with clock skew and the private-IP share of
 * server events) and the secret keys that leaked to the browser endpoint. Runs on the QUERY pool.
 *
 * INVARIANTS
 * - Window statements are bounded by `occurred_at >= from AND occurred_at < to` (partition
 *   pruning); counters by `bucket_hour`, aligned to the hour bucket that CONTAINS `from`.
 * - The newest event per app is an index-backed backward scan (`idx_*_app_id_occurred_at`,
 *   ORDER BY … DESC LIMIT 1), so "never / stale" sees every retained partition cheaply.
 * - IP-class and source literals come from typed constants, never from input.
 * @see ../../migrations/0006_ingest_counters.sql
 * @see ../../migrations/0004_api_requests.sql (sdk, clock_skew_ms, ip_class)
 * @see ../../migrations/0005_web_events.sql (sdk, clock_skew_ms)
 * @see ../../migrations/0002_apps_and_api_keys.sql (traffic.apps, api_keys.exposed_at)
 */
import type { IngestSource, IpClass } from '@nexus/shared';
import type { Pool } from 'pg';

import type { Executor } from '../db/executor';
import { bucketExpr } from '../db/sql';
import type {
  AppHealthRow,
  ExposedKeyRow,
  IngestCounterSumRow,
  IngestHealthRows,
  SdkHealthRow,
} from '../domain/rows';

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
 * skew; `ipColumns` adds the private-IP counts (server table only — browser IPs are resolved by
 * OUR proxy settings, not the sender's).
 */
function sdkHealthSql(table: string, source: IngestSource, ipColumns: string): string {
  return `
SELECT e.app_id, '${source}' AS source, e.sdk, count(*)::int8 AS events,
       max(e.occurred_at) AS last_seen_at,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY e.clock_skew_ms) AS median_skew_ms,
       max(abs(e.clock_skew_ms))::int8 AS max_abs_skew_ms,
       ${ipColumns}
  FROM ${table} e
 WHERE e.occurred_at >= $1 AND e.occurred_at < $2
 GROUP BY e.app_id, e.sdk`;
}

export const SERVER_SDK_HEALTH_SQL = sdkHealthSql(
  'traffic.api_requests',
  SERVER,
  `count(*) FILTER (WHERE e.ip_class IN (${PROXY_IP_LIST}))::int8 AS private_ip_events,
       count(*) FILTER (WHERE e.ip_class <> '${UNKNOWN_IP_CLASS}')::int8 AS classified_ip_events`,
);

export const BROWSER_SDK_HEALTH_SQL = sdkHealthSql(
  'traffic.web_events',
  BROWSER,
  '0::int8 AS private_ip_events, 0::int8 AS classified_ip_events',
);

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
   * The five reads of the Integration page, run in parallel (independent, all read-only).
   * `from`/`to` bound the window statements; `to` is also "now" for key expiry.
   */
  async perApp(from: Date, to: Date, exec: Executor = this.db): Promise<IngestHealthRows> {
    const [apps, counters, serverSdks, browserSdks, exposedKeys] = await Promise.all([
      exec.query<AppHealthRow>(APP_HEALTH_SQL),
      exec.query<IngestCounterSumRow>(COUNTER_SUM_SQL, [from]),
      exec.query<SdkHealthRow>(SERVER_SDK_HEALTH_SQL, [from, to]),
      exec.query<SdkHealthRow>(BROWSER_SDK_HEALTH_SQL, [from, to]),
      exec.query<ExposedKeyRow>(EXPOSED_KEYS_SQL, [to]),
    ]);
    return {
      apps: apps.rows,
      counters: counters.rows,
      sdks: [...serverSdks.rows, ...browserSdks.rows],
      exposedKeys: exposedKeys.rows,
    };
  }
}
