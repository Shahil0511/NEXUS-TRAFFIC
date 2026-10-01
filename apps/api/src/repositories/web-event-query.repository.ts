/**
 * READ side of `traffic.web_events` (browser tracker events) for the dashboard. Runs on the QUERY
 * pool. Browser ingest arrives in S3; until then these queries simply return zeros.
 *
 * INVARIANTS: same as ApiRequestQueryRepository — every query is bounded by
 * `occurred_at >= from AND occurred_at < to` (partition pruning) plus the optional app scope.
 * @see ../../migrations/0005_web_events.sql
 * @see ../../migrations/0004_api_requests.sql (countActiveUsers also reads api_requests)
 */
import type { BrowserEventType, Grain } from '@nexus/shared';
import type { Pool } from 'pg';

import type { Executor } from '../db/executor';
import { bucketExpr, ParamList } from '../db/sql';
import type { TrafficFilter } from '../domain/filters';
import type { PageViewBucketRow } from '../domain/rows';

/** The event type counted as a page view (BROWSER_EVENT_TYPE_VALUES). */
const PAGE_VIEW: BrowserEventType = 'page_view';
const IS_PAGE_VIEW = `w.event_type = '${PAGE_VIEW}'`;

/**
 * Window + app scope for a table aliased `alias` (endpoint scope does not apply to web events).
 * `alias` MUST be a trusted identifier.
 */
function windowConditions(alias: string, filter: TrafficFilter, params: ParamList): string[] {
  const conditions = [
    `${alias}.occurred_at >= ${params.add(filter.from)}`,
    `${alias}.occurred_at < ${params.add(filter.to)}`,
  ];
  if (filter.appId !== undefined) conditions.push(`${alias}.app_id = ${params.add(filter.appId)}`);
  return conditions;
}

export class WebEventQueryRepository {
  constructor(private readonly db: Pool) {}

  /** Number of page views in the window (Overview KPI). */
  async summarizePageViews(filter: TrafficFilter, exec: Executor = this.db): Promise<number> {
    const params = new ParamList();
    const { rows } = await exec.query<{ page_views: number }>(
      `SELECT count(*) AS page_views
         FROM traffic.web_events w
        WHERE ${[...windowConditions('w', filter, params), IS_PAGE_VIEW].join(' AND ')}`,
      params.values,
    );
    return rows[0]?.page_views ?? 0;
  }

  /** Page views per IST-aligned bucket (same buckets as ApiRequestQueryRepository.timeseries). */
  async pageViewTimeseries(
    filter: TrafficFilter,
    grain: Grain,
    exec: Executor = this.db,
  ): Promise<PageViewBucketRow[]> {
    const params = new ParamList();
    const { rows } = await exec.query<PageViewBucketRow>(
      `SELECT ${bucketExpr(grain, 'w.occurred_at')} AS bucket, count(*) AS page_views
         FROM traffic.web_events w
        WHERE ${[...windowConditions('w', filter, params), IS_PAGE_VIEW].join(' AND ')}
        GROUP BY 1
        ORDER BY 1`,
      params.values,
    );
    return rows;
  }

  /**
   * Distinct people active in the window across BOTH tables: an identified user counts by
   * `user_key`, an anonymous visitor by `session_id` (API calls with neither are not countable).
   * Used with a window of the last ACTIVE_USER_WINDOW_MS for "active users now".
   */
  async countActiveUsers(filter: TrafficFilter, exec: Executor = this.db): Promise<number> {
    const params = new ParamList();
    const apiScope = windowConditions('r', filter, params).join(' AND ');
    const webScope = windowConditions('w', filter, params).join(' AND ');
    const { rows } = await exec.query<{ active_users: number }>(
      `SELECT count(DISTINCT actor) AS active_users
         FROM (
           SELECT coalesce(r.user_key::text, r.session_id::text) AS actor
             FROM traffic.api_requests r
            WHERE ${apiScope}
           UNION ALL
           SELECT coalesce(w.user_key::text, w.session_id::text) AS actor
             FROM traffic.web_events w
            WHERE ${webScope}
         ) actors
        WHERE actor IS NOT NULL`,
      params.values,
    );
    return rows[0]?.active_users ?? 0;
  }
}
