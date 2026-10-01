/**
 * READ side of `traffic.api_requests`: every aggregate behind the Overview, API Routes and Errors
 * pages. Runs on the QUERY pool (read-only transactions, longer statement timeout), so dashboard
 * reads never queue behind ingest writes.
 *
 * INVARIANTS
 * - Every query is bounded by `occurred_at >= from AND occurred_at < to` (partition pruning on the
 *   monthly partitions) plus the optional app / endpoint scope — see `scopeConditions`.
 * - Latency (percentiles, avg, slowest calls) uses kind = 'http' ONLY; streams would skew p95.
 * - Failure filters emit the partial-index predicate LITERALLY (`FAILURE_PREDICATES`), never as a
 *   parameter: the planner can use `idx_api_requests_occurred_at_failed` only when it can prove at
 *   plan time that the WHERE clause implies `status_code >= 400`.
 * - ORDER BY comes only from the `ENDPOINT_ORDER_SQL` whitelist (via `orderByClause`).
 * - Signatures stay stable when v1.1 adds rollups: only the SQL in here changes.
 * @see ../../migrations/0004_api_requests.sql
 * @see ../../migrations/0002_apps_and_api_keys.sql (traffic.apps, joined for the public slug)
 */
import type { Grain, ServerEventKind, StatusClass } from '@nexus/shared';
import type { Pool } from 'pg';

import type { Executor } from '../db/executor';
import { bucketExpr, keysetTimeExpr, likeContains, orderByClause, ParamList } from '../db/sql';
import type {
  EndpointListOptions,
  EndpointStatsOrder,
  FailureListOptions,
  TrafficFilter,
} from '../domain/filters';
import type {
  ApiRequestRow,
  EndpointDetailRows,
  EndpointStatsRow,
  ErrorSummaryRows,
  ErrorTotalsRow,
  StatusCountRow,
  TrafficBucketRow,
  TrafficSummaryRow,
} from '../domain/rows';

// ─── SQL fragments (trusted, frozen) ────────────────────────────────────────

/** How many slowest calls the endpoint detail page lists. */
export const SLOWEST_SAMPLES_LIMIT = 20;
/** How many endpoints the Errors page lists as "top failing". */
export const TOP_FAILING_ENDPOINTS_LIMIT = 10;

/** The only kind that counts for latency (SERVER_EVENT_KIND_VALUES; streams are excluded). */
const LATENCY_KIND: ServerEventKind = 'http';
const IS_LATENCY_KIND = `r.kind = '${LATENCY_KIND}'`;

/**
 * Status-class predicates. Each one contains the partial-index predicate `status_code >= 400`
 * VERBATIM (idx_api_requests_occurred_at_failed), so every failure query can use that index.
 * NEVER parameterise these.
 */
export const FAILURE_PREDICATES = Object.freeze({
  all: 'r.status_code >= 400',
  '4xx': 'r.status_code >= 400 AND r.status_code < 500',
  '5xx': 'r.status_code >= 400 AND r.status_code >= 500',
} as const satisfies Record<StatusClass, string>);

/** Endpoint-stats sort key → SQL over the `stats` CTE. The ONLY ORDER BY sources (whitelist). */
const ENDPOINT_ORDER_SQL = Object.freeze({
  calls: 's.calls',
  errorRate: '(s.errors_4xx + s.errors_5xx)::float8 / s.calls',
  p50: 's.p50_ms',
  p95: 's.p95_ms',
  p99: 's.p99_ms',
  avg: 's.avg_ms',
  errors: '(s.errors_4xx + s.errors_5xx)',
} as const satisfies Record<EndpointStatsOrder, string>);

/** `percentile_cont(f)` of duration over http rows only (NULL when the group has none). */
function latencyPercentile(fraction: number): string {
  return `percentile_cont(${fraction}) WITHIN GROUP (ORDER BY r.duration_ms) FILTER (WHERE ${IS_LATENCY_KIND})`;
}

/**
 * The columns of ApiRequestRow (list endpoints); `ip` as plain text without a prefix length and
 * occurred_at once more as µs-precision text for keyset cursors.
 */
const SAMPLE_COLUMNS = `r.occurred_at, ${keysetTimeExpr('r.occurred_at')} AS occurred_at_key,
  r.event_id, a.slug AS app_slug, r.endpoint_id, r.kind, r.method, r.route_template, r.path,
  r.status_code, r.duration_ms, r.error_code, r.request_id, r.session_id, r.user_email, r.user_key,
  r.claimed_email, r.identity_source, host(r.ip) AS ip, r.ip_class, r.geo_country, r.geo_region,
  r.geo_city`;

/** The time window (partition pruning) + optional app / endpoint scope, as AND-able conditions. */
export function scopeConditions(filter: TrafficFilter, params: ParamList): string[] {
  const conditions = [
    `r.occurred_at >= ${params.add(filter.from)}`,
    `r.occurred_at < ${params.add(filter.to)}`,
  ];
  if (filter.appId !== undefined) conditions.push(`r.app_id = ${params.add(filter.appId)}`);
  if (filter.endpointId !== undefined)
    conditions.push(`r.endpoint_id = ${params.add(filter.endpointId)}`);
  return conditions;
}

/** Extra knobs of the shared endpoint-stats statement. */
interface EndpointStatsQuery extends EndpointListOptions {
  /** Keep only endpoints with at least one failure (Errors page). */
  onlyFailing?: boolean;
}

/** One statement for the Routes list, the detail header and the top failing endpoints. */
function endpointStatsStatement(
  filter: TrafficFilter,
  query: EndpointStatsQuery,
): { text: string; values: unknown[] } {
  const params = new ParamList();
  const where = scopeConditions(filter, params);
  if (query.search) where.push(`r.route_template ILIKE ${params.add(likeContains(query.search))}`);
  const having = query.onlyFailing
    ? `HAVING count(*) FILTER (WHERE ${FAILURE_PREDICATES.all}) > 0`
    : '';
  const text = `WITH stats AS (
    SELECT r.endpoint_id, r.app_id, r.method, r.route_template,
           count(*) AS calls,
           count(*) FILTER (WHERE ${FAILURE_PREDICATES['4xx']}) AS errors_4xx,
           count(*) FILTER (WHERE ${FAILURE_PREDICATES['5xx']}) AS errors_5xx,
           ${latencyPercentile(0.5)} AS p50_ms,
           ${latencyPercentile(0.95)} AS p95_ms,
           ${latencyPercentile(0.99)} AS p99_ms,
           avg(r.duration_ms) FILTER (WHERE ${IS_LATENCY_KIND}) AS avg_ms,
           max(r.occurred_at) AS last_seen_at
      FROM traffic.api_requests r
     WHERE ${where.join(' AND ')}
     GROUP BY r.endpoint_id, r.app_id, r.method, r.route_template
     ${having}
  )
  SELECT s.endpoint_id, a.slug AS app_slug, s.method, s.route_template, s.calls, s.errors_4xx,
         s.errors_5xx, s.p50_ms, s.p95_ms, s.p99_ms, s.avg_ms, s.last_seen_at
    FROM stats s
    JOIN traffic.apps a ON a.id = s.app_id
   ${orderByClause(ENDPOINT_ORDER_SQL, query.sort, query.dir)}, s.endpoint_id ASC
   LIMIT ${params.add(query.limit)} OFFSET ${params.add(query.offset)}`;
  return { text, values: params.values };
}

// ─── Repository ─────────────────────────────────────────────────────────────

export class ApiRequestQueryRepository {
  constructor(private readonly db: Pool) {}

  /** Overview KPIs: requests, failures (>= 400), p95 (http only), distinct identified users. */
  async summarizeTraffic(
    filter: TrafficFilter,
    exec: Executor = this.db,
  ): Promise<TrafficSummaryRow> {
    const params = new ParamList();
    const { rows } = await exec.query<TrafficSummaryRow>(
      `SELECT count(*) AS requests,
              count(*) FILTER (WHERE ${FAILURE_PREDICATES.all}) AS errors,
              ${latencyPercentile(0.95)} AS p95_ms,
              count(DISTINCT r.user_key) AS identified_users
         FROM traffic.api_requests r
        WHERE ${scopeConditions(filter, params).join(' AND ')}`,
      params.values,
    );
    return rows[0] ?? { requests: 0, errors: 0, p95_ms: null, identified_users: 0 };
  }

  /** Requests / 4xx / 5xx / p95 per IST-aligned bucket; only buckets with rows (gaps filled later). */
  async timeseries(
    filter: TrafficFilter,
    grain: Grain,
    exec: Executor = this.db,
  ): Promise<TrafficBucketRow[]> {
    const params = new ParamList();
    const { rows } = await exec.query<TrafficBucketRow>(
      `SELECT ${bucketExpr(grain, 'r.occurred_at')} AS bucket,
              count(*) AS requests,
              count(*) FILTER (WHERE ${FAILURE_PREDICATES['4xx']}) AS errors_4xx,
              count(*) FILTER (WHERE ${FAILURE_PREDICATES['5xx']}) AS errors_5xx,
              ${latencyPercentile(0.95)} AS p95_ms
         FROM traffic.api_requests r
        WHERE ${scopeConditions(filter, params).join(' AND ')}
        GROUP BY 1
        ORDER BY 1`,
      params.values,
    );
    return rows;
  }

  /** One row per (endpoint, app, method, route template), sorted by a whitelisted key, offset-paged. */
  async listEndpointStats(
    filter: TrafficFilter,
    options: EndpointListOptions,
    exec: Executor = this.db,
  ): Promise<EndpointStatsRow[]> {
    return this.queryEndpointStats(filter, options, exec);
  }

  /**
   * Stats + timeseries + status breakdown + the SLOWEST_SAMPLES_LIMIT slowest http calls of one
   * stored endpoint_id. Null when the endpoint has no rows in the window (→ 404).
   */
  async getEndpointDetail(
    endpointId: string,
    filter: TrafficFilter,
    grain: Grain,
    exec: Executor = this.db,
  ): Promise<EndpointDetailRows | null> {
    const scoped: TrafficFilter = { ...filter, endpointId };
    const [stats] = await this.queryEndpointStats(
      scoped,
      { sort: 'calls', dir: 'desc', limit: 1, offset: 0 },
      exec,
    );
    if (!stats) return null;
    const [timeseries, statusBreakdown, slowest] = await Promise.all([
      this.timeseries(scoped, grain, exec),
      this.countByStatus(scoped, null, exec),
      this.listSlowest(scoped, SLOWEST_SAMPLES_LIMIT, exec),
    ]);
    return { stats, timeseries, statusBreakdown, slowest };
  }

  /** Failure totals, failures per status, the request/error series and the top failing endpoints. */
  async summarizeErrors(
    filter: TrafficFilter,
    grain: Grain,
    exec: Executor = this.db,
  ): Promise<ErrorSummaryRows> {
    const [totals, byStatus, timeseries, topEndpoints] = await Promise.all([
      this.countFailures(filter, exec),
      this.countByStatus(filter, 'all', exec),
      this.timeseries(filter, grain, exec),
      this.queryEndpointStats(
        filter,
        {
          sort: 'errors',
          dir: 'desc',
          limit: TOP_FAILING_ENDPOINTS_LIMIT,
          offset: 0,
          onlyFailing: true,
        },
        exec,
      ),
    ]);
    return { totals, byStatus, timeseries, topEndpoints };
  }

  /** Failed requests (status class), newest first, keyset-paged on (occurred_at, event_id) DESC. */
  async listFailures(
    filter: TrafficFilter,
    options: FailureListOptions,
    exec: Executor = this.db,
  ): Promise<ApiRequestRow[]> {
    const params = new ParamList();
    const where = [...scopeConditions(filter, params), FAILURE_PREDICATES[options.statusClass]];
    if (options.after) {
      where.push(
        `(r.occurred_at, r.event_id) < (${params.add(options.after.occurredAt)}::timestamptz, ${params.add(options.after.eventId)}::uuid)`,
      );
    }
    const { rows } = await exec.query<ApiRequestRow>(
      `SELECT ${SAMPLE_COLUMNS}
         FROM traffic.api_requests r
         JOIN traffic.apps a ON a.id = r.app_id
        WHERE ${where.join(' AND ')}
        ORDER BY r.occurred_at DESC, r.event_id DESC
        LIMIT ${params.add(options.limit)}`,
      params.values,
    );
    return rows;
  }

  // ─── Building blocks of the composite methods ─────────────────────────────

  /** Runs the shared endpoint-stats statement (list, detail header, top failing). */
  private async queryEndpointStats(
    filter: TrafficFilter,
    query: EndpointStatsQuery,
    exec: Executor,
  ): Promise<EndpointStatsRow[]> {
    const { text, values } = endpointStatsStatement(filter, query);
    const { rows } = await exec.query<EndpointStatsRow>(text, values);
    return rows;
  }

  /** Totals over failed requests only (uses the partial index). */
  private async countFailures(filter: TrafficFilter, exec: Executor): Promise<ErrorTotalsRow> {
    const params = new ParamList();
    const { rows } = await exec.query<ErrorTotalsRow>(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE r.status_code < 500) AS errors_4xx,
              count(*) FILTER (WHERE r.status_code >= 500) AS errors_5xx
         FROM traffic.api_requests r
        WHERE ${[...scopeConditions(filter, params), FAILURE_PREDICATES.all].join(' AND ')}`,
      params.values,
    );
    return rows[0] ?? { total: 0, errors_4xx: 0, errors_5xx: 0 };
  }

  /** Rows per status code, most frequent first; `statusClass` null = every status. */
  private async countByStatus(
    filter: TrafficFilter,
    statusClass: StatusClass | null,
    exec: Executor,
  ): Promise<StatusCountRow[]> {
    const params = new ParamList();
    const where = scopeConditions(filter, params);
    if (statusClass) where.push(FAILURE_PREDICATES[statusClass]);
    const { rows } = await exec.query<StatusCountRow>(
      `SELECT r.status_code, count(*) AS count
         FROM traffic.api_requests r
        WHERE ${where.join(' AND ')}
        GROUP BY r.status_code
        ORDER BY count DESC, r.status_code ASC`,
      params.values,
    );
    return rows;
  }

  /** The slowest http calls, slowest first (ties: newest first). */
  private async listSlowest(
    filter: TrafficFilter,
    limit: number,
    exec: Executor,
  ): Promise<ApiRequestRow[]> {
    const params = new ParamList();
    const { rows } = await exec.query<ApiRequestRow>(
      `SELECT ${SAMPLE_COLUMNS}
         FROM traffic.api_requests r
         JOIN traffic.apps a ON a.id = r.app_id
        WHERE ${[...scopeConditions(filter, params), IS_LATENCY_KIND].join(' AND ')}
        ORDER BY r.duration_ms DESC, r.occurred_at DESC, r.event_id DESC
        LIMIT ${params.add(limit)}`,
      params.values,
    );
    return rows;
  }
}
