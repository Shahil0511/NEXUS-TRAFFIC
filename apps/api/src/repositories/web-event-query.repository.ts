/**
 * READ side of `traffic.web_events` (browser tracker events) for the dashboard: the Overview
 * page-view numbers and every aggregate behind Users, Journeys, Pages & Tools and Geography
 * (several of which also read `traffic.api_requests`, the other half of a user's activity).
 * Runs on the QUERY pool.
 *
 * INVARIANTS (same as ApiRequestQueryRepository)
 * - Every query is bounded by `occurred_at >= from AND occurred_at < to` on EVERY table it reads
 *   (partition pruning) plus the optional app scope — see `windowConditions`.
 * - A "user" is a VERIFIED identity only: `user_key IS NOT NULL` ⇔ identity_source ∈
 *   IDENTIFIED_SOURCE_VALUES (the CHECKs of 0004/0005 guarantee it). Claims never count.
 * - `page_time` rows carry visible-ms DELTAS; the time of a page view is Σ visible_ms of the
 *   page_time rows whose page_view_id = that page view's event_id (`pageViewVisibleMs`).
 * - Session order is (seq, occurred_at, event_id) — `SESSION_ORDER`.
 * - Enum literals in SQL come from typed constants (BROWSER_EVENT_TYPE_VALUES, TimelineItemKind,
 *   IDENTITY_SOURCE_VALUES), never from input; values always go through `$n` placeholders.
 * @see ../../migrations/0005_web_events.sql
 * @see ../../migrations/0004_api_requests.sql (users, timeline, sessions and geo also read api_requests)
 * @see ../../migrations/0002_apps_and_api_keys.sql (traffic.apps, joined for the public slug)
 */
import {
  IDENTITY_SOURCE_VALUES,
  type BrowserEventType,
  type Grain,
  type TimelineItemKind,
} from '@nexus/shared';
import type { Pool } from 'pg';

import type { Executor } from '../db/executor';
import { bucketExpr, keysetTimeExpr, likeContains, ParamList } from '../db/sql';
import type {
  EventKeyset,
  SessionListOptions,
  TimelineOptions,
  TrafficFilter,
  UserListOptions,
} from '../domain/filters';
import type {
  ActivityBucketRow,
  AppActivityRow,
  GeoCityRow,
  GeoCountryRow,
  LiveEventRow,
  PageStatsRow,
  PageViewBucketRow,
  SessionEventRow,
  SessionRows,
  SessionSummaryRow,
  TimelineEventRow,
  ToolTrendRow,
  ToolUsageRow,
  ToolUsageRows,
  TopPathRow,
  UserPageCountRow,
  UserProfileRows,
  UserSummaryRow,
  UserToolCountRow,
} from '../domain/rows';
import { FAILURE_PREDICATES } from './api-request-query.repository';

// ─── SQL fragments (trusted, frozen) ────────────────────────────────────────

/** How many tools / pages / countries the user profile lists. */
export const PROFILE_TOP_LIMIT = 10;
/** Safety cap on the events of one session replay (a runaway tab must not return 100k rows). */
export const SESSION_EVENT_LIMIT = 2000;

const PAGE_VIEW: BrowserEventType = 'page_view';
const PAGE_TIME: BrowserEventType = 'page_time';
const TOOL_USE: BrowserEventType = 'tool_use';
/** The timeline / replay kind of an API call (TIMELINE_ITEM_KIND_VALUES). */
const API_KIND: TimelineItemKind = 'api';

const IS_PAGE_VIEW = `w.event_type = '${PAGE_VIEW}'`;
/** `tool IS NOT NULL` verbatim so the planner can use idx_web_events_app_id_tool_occurred_at. */
const IS_TOOL_USE = `w.tool IS NOT NULL AND w.event_type = '${TOOL_USE}'`;

/** Replay order of the events of one session (alias `w`). */
const SESSION_ORDER = 'w.seq, w.occurred_at, w.event_id';

/** IDENTITY_SOURCE_VALUES (strongest first) as a SQL array: rank = array_position. */
const IDENTITY_RANKS = `ARRAY[${IDENTITY_SOURCE_VALUES.map((v) => `'${v}'`).join(', ')}]::text[]`;

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

/** `(alias.occurred_at, alias.event_id) < keyset` — newest-first keyset paging. */
function olderThan(alias: string, after: EventKeyset, params: ParamList): string {
  return `(${alias}.occurred_at, ${alias}.event_id) < (${params.add(after.occurredAt)}::timestamptz, ${params.add(after.eventId)}::uuid)`;
}

/**
 * Σ visible_ms of the page view in row `w` (NULL for other event types or when no page_time
 * arrived). The page_time rows are bounded by the same window (partition pruning) and found via
 * idx_web_events_page_view_id.
 */
function pageViewVisibleMs(filter: TrafficFilter, params: ParamList): string {
  return `CASE WHEN ${IS_PAGE_VIEW} THEN (
      SELECT sum(pt.visible_ms)
        FROM traffic.web_events pt
       WHERE pt.event_type = '${PAGE_TIME}'
         AND pt.page_view_id = w.event_id
         AND pt.occurred_at >= ${params.add(filter.from)}
         AND pt.occurred_at < ${params.add(filter.to)}
    ) END`;
}

/** First non-null value of `expr` in the group, in `order` (e.g. the entry page of a session). */
function firstOf(expr: string, order: string, nonNull = `${expr} IS NOT NULL`): string {
  return `(array_agg(${expr} ORDER BY ${order}) FILTER (WHERE ${nonNull}))[1]`;
}

/** Extra knobs of the shared user-stats statement. */
interface UserStatsQuery extends UserListOptions {
  /** One user only (profile header). */
  userKey?: Buffer;
}

/**
 * One row per verified user over api_requests ∪ web_events: list, search and the profile header.
 * Users are ordered most recently seen first (ties: user_key). `sessions` counts BROWSER sessions
 * only — the ones Journeys lists — so "3 sessions" always opens 3 replayable sessions.
 */
function userStatsStatement(
  filter: TrafficFilter,
  query: UserStatsQuery,
): { text: string; values: unknown[] } {
  const params = new ParamList();
  const api = [...windowConditions('r', filter, params), 'r.user_key IS NOT NULL'];
  const web = [...windowConditions('w', filter, params), 'w.user_key IS NOT NULL'];
  if (query.userKey) {
    const key = params.add(query.userKey);
    api.push(`r.user_key = ${key}`);
    web.push(`w.user_key = ${key}`);
  }
  if (query.search) {
    const pattern = params.add(likeContains(query.search));
    api.push(`r.user_email ILIKE ${pattern}`);
    web.push(`w.user_email ILIKE ${pattern}`);
  }
  const text = `WITH activity AS (
      SELECT r.user_key, r.user_email, r.app_id, r.session_id, r.occurred_at,
             '${API_KIND}'::text AS kind, (${FAILURE_PREDICATES.all}) AS failed
        FROM traffic.api_requests r
       WHERE ${api.join(' AND ')}
      UNION ALL
      SELECT w.user_key, w.user_email, w.app_id, w.session_id, w.occurred_at,
             w.event_type AS kind, false AS failed
        FROM traffic.web_events w
       WHERE ${web.join(' AND ')}
    )
    SELECT u.user_key, min(u.user_email) AS user_email,
           min(u.occurred_at) AS first_seen_at, max(u.occurred_at) AS last_seen_at,
           count(*) FILTER (WHERE u.kind = '${API_KIND}') AS requests,
           count(*) FILTER (WHERE u.failed) AS failed_requests,
           count(*) FILTER (WHERE u.kind = '${PAGE_VIEW}') AS page_views,
           count(DISTINCT u.session_id) FILTER (WHERE u.kind <> '${API_KIND}') AS sessions,
           array_agg(DISTINCT a.slug ORDER BY a.slug) AS apps
      FROM activity u
      JOIN traffic.apps a ON a.id = u.app_id
     GROUP BY u.user_key
     ORDER BY max(u.occurred_at) DESC, u.user_key ASC
     LIMIT ${params.add(query.limit)} OFFSET ${params.add(query.offset)}`;
  return { text, values: params.values };
}

/** Extra knobs of the shared session-stats statement. */
interface SessionStatsQuery extends SessionListOptions {
  /** One session only (replay header); combine with filter.appId. */
  sessionId?: string;
}

/**
 * One row per (app, session_id) of browser events: list and replay header. Identity = the
 * strongest source seen (`IDENTITY_RANKS`); entry/exit = first/last page view in SESSION_ORDER.
 */
function sessionStatsStatement(
  filter: TrafficFilter,
  query: SessionStatsQuery,
): { text: string; values: unknown[] } {
  const params = new ParamList();
  const where = windowConditions('w', filter, params);
  if (query.sessionId !== undefined) where.push(`w.session_id = ${params.add(query.sessionId)}`);
  if (query.userKey) {
    where.push(`(w.app_id, w.session_id) IN (
        SELECT u.app_id, u.session_id
          FROM traffic.web_events u
         WHERE ${[...windowConditions('u', filter, params), `u.user_key = ${params.add(query.userKey)}`].join(' AND ')}
      )`);
  }
  const text = `SELECT a.slug AS app_slug, w.session_id,
           min(w.occurred_at) AS started_at, max(w.occurred_at) AS last_seen_at,
           extract(epoch FROM max(w.occurred_at) - min(w.occurred_at)) * 1000 AS duration_ms,
           count(*) FILTER (WHERE ${IS_PAGE_VIEW}) AS page_views,
           count(*) FILTER (WHERE w.event_type = '${TOOL_USE}') AS tool_uses,
           coalesce(sum(w.visible_ms) FILTER (WHERE w.event_type = '${PAGE_TIME}'), 0) AS visible_ms,
           ${firstOf('w.user_key', 'w.occurred_at DESC')} AS user_key,
           ${firstOf('w.user_email', 'w.occurred_at DESC')} AS user_email,
           ${firstOf('w.claimed_email', 'w.occurred_at DESC')} AS claimed_email,
           (${IDENTITY_RANKS})[min(array_position(${IDENTITY_RANKS}, w.identity_source))] AS identity_source,
           ${firstOf('w.path_template', SESSION_ORDER, IS_PAGE_VIEW)} AS entry_path,
           ${firstOf('w.path_template', 'w.seq DESC, w.occurred_at DESC, w.event_id DESC', IS_PAGE_VIEW)} AS exit_path,
           ${firstOf('w.geo_country', 'w.occurred_at')} AS country,
           ${firstOf('host(w.ip)', 'w.occurred_at', 'w.ip IS NOT NULL')} AS ip
      FROM traffic.web_events w
      JOIN traffic.apps a ON a.id = w.app_id
     WHERE ${where.join(' AND ')}
     GROUP BY a.slug, w.session_id
     ORDER BY max(w.occurred_at) DESC, a.slug ASC, w.session_id ASC
     LIMIT ${params.add(query.limit)} OFFSET ${params.add(query.offset)}`;
  return { text, values: params.values };
}

/** Geography grouping levels → the columns they group by (trusted, frozen). */
const GEO_LEVEL_COLUMNS = Object.freeze({
  country: ['geo_country'],
  city: ['geo_country', 'geo_region', 'geo_city'],
} as const);
type GeoLevel = keyof typeof GEO_LEVEL_COLUMNS;

/**
 * API calls ∪ browser page views grouped by location. `requests` = API calls, `page_views` =
 * page views, `users` = distinct verified users. Busiest first; unknown location last on ties.
 */
function geoStatement(
  level: GeoLevel,
  filter: TrafficFilter,
  limit: number,
): { text: string; values: unknown[] } {
  const params = new ParamList();
  const api = windowConditions('r', filter, params).join(' AND ');
  const web = [...windowConditions('w', filter, params), IS_PAGE_VIEW].join(' AND ');
  const columns = GEO_LEVEL_COLUMNS[level];
  const centroid = level === 'city' ? ', avg(h.geo_lat) AS lat, avg(h.geo_lon) AS lon' : '';
  const outputNames = { geo_country: 'country', geo_region: 'region', geo_city: 'city' } as const;
  const text = `WITH hits AS (
      SELECT r.geo_country, r.geo_region, r.geo_city, r.geo_lat, r.geo_lon, r.user_key,
             '${API_KIND}'::text AS kind
        FROM traffic.api_requests r
       WHERE ${api}
      UNION ALL
      SELECT w.geo_country, w.geo_region, w.geo_city, w.geo_lat, w.geo_lon, w.user_key,
             w.event_type AS kind
        FROM traffic.web_events w
       WHERE ${web}
    )
    SELECT ${columns.map((c) => `h.${c} AS ${outputNames[c]}`).join(', ')}${centroid},
           count(*) FILTER (WHERE h.kind = '${API_KIND}') AS requests,
           count(*) FILTER (WHERE h.kind = '${PAGE_VIEW}') AS page_views,
           count(DISTINCT h.user_key) AS users
      FROM hits h
     GROUP BY ${columns.map((c) => `h.${c}`).join(', ')}
     ORDER BY count(*) DESC, ${columns.map((c) => `h.${c} ASC NULLS LAST`).join(', ')}
     LIMIT ${params.add(limit)}`;
  return { text, values: params.values };
}

// ─── Repository ─────────────────────────────────────────────────────────────

export class WebEventQueryRepository {
  constructor(private readonly db: Pool) {}

  // ─── Overview ─────────────────────────────────────────────────────────────

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

  /**
   * Distinct VERIFIED users in the window over API calls + browser events — the Overview KPI, with
   * the same definition as the Users page (userStatsStatement), so the two numbers agree.
   */
  async countIdentifiedUsers(filter: TrafficFilter, exec: Executor = this.db): Promise<number> {
    const params = new ParamList();
    const api = [...windowConditions('r', filter, params), 'r.user_key IS NOT NULL'];
    const web = [...windowConditions('w', filter, params), 'w.user_key IS NOT NULL'];
    const { rows } = await exec.query<{ users: number }>(
      `SELECT count(DISTINCT u.user_key) AS users
         FROM (
           SELECT r.user_key FROM traffic.api_requests r WHERE ${api.join(' AND ')}
           UNION ALL
           SELECT w.user_key FROM traffic.web_events w WHERE ${web.join(' AND ')}
         ) u`,
      params.values,
    );
    return rows[0]?.users ?? 0;
  }

  /**
   * Per app (apps without any event are absent): distinct verified users over BOTH tables, page
   * views, browser sessions, tool uses and the newest event — the Applications page.
   */
  async summarizeActivityByApp(
    filter: TrafficFilter,
    exec: Executor = this.db,
  ): Promise<AppActivityRow[]> {
    const params = new ParamList();
    const api = windowConditions('r', filter, params).join(' AND ');
    const web = windowConditions('w', filter, params).join(' AND ');
    const { rows } = await exec.query<AppActivityRow>(
      `SELECT h.app_id,
              count(DISTINCT h.user_key) AS users,
              count(*) FILTER (WHERE h.kind = '${PAGE_VIEW}') AS page_views,
              count(DISTINCT h.session_id) FILTER (WHERE h.kind <> '${API_KIND}') AS sessions,
              count(*) FILTER (WHERE h.kind = '${TOOL_USE}') AS tool_uses,
              max(h.occurred_at) AS last_event_at
         FROM (
           SELECT r.app_id, r.user_key, r.session_id, r.occurred_at, '${API_KIND}'::text AS kind
             FROM traffic.api_requests r
            WHERE ${api}
           UNION ALL
           SELECT w.app_id, w.user_key, w.session_id, w.occurred_at, w.event_type AS kind
             FROM traffic.web_events w
            WHERE ${web}
         ) h
        GROUP BY h.app_id`,
      params.values,
    );
    return rows;
  }

  // ─── Live ─────────────────────────────────────────────────────────────────

  /** Page views and tool uses per IST-aligned bucket (Live backfill; gaps filled by the service). */
  async activityTimeseries(
    filter: TrafficFilter,
    grain: Grain,
    exec: Executor = this.db,
  ): Promise<ActivityBucketRow[]> {
    const params = new ParamList();
    const { rows } = await exec.query<ActivityBucketRow>(
      `SELECT ${bucketExpr(grain, 'w.occurred_at')} AS bucket,
              count(*) FILTER (WHERE ${IS_PAGE_VIEW}) AS page_views,
              count(*) FILTER (WHERE ${IS_TOOL_USE}) AS tool_uses
         FROM traffic.web_events w
        WHERE ${[...windowConditions('w', filter, params), `w.event_type IN ('${PAGE_VIEW}', '${TOOL_USE}')`].join(' AND ')}
        GROUP BY 1
        ORDER BY 1`,
      params.values,
    );
    return rows;
  }

  /**
   * The newest API calls and browser events (page_time deltas excluded: they are not "something
   * happened"), merged newest first. Each branch is limited before the merge.
   */
  async listRecentEvents(
    filter: TrafficFilter,
    limit: number,
    exec: Executor = this.db,
  ): Promise<LiveEventRow[]> {
    const params = new ParamList();
    const api = windowConditions('r', filter, params);
    const web = [...windowConditions('w', filter, params), `w.event_type <> '${PAGE_TIME}'`];
    const limitParam = params.add(limit);
    const { rows } = await exec.query<LiveEventRow>(
      `SELECT * FROM (
         (SELECT r.occurred_at, r.event_id, '${API_KIND}'::text AS kind, a.slug AS app_slug, r.path,
                 r.method, r.status_code::int AS status_code, r.duration_ms::float8 AS duration_ms,
                 NULL::text AS tool, r.user_email, r.user_key, r.endpoint_id, r.session_id,
                 host(r.ip) AS ip, r.geo_country, r.geo_city
            FROM traffic.api_requests r
            JOIN traffic.apps a ON a.id = r.app_id
           WHERE ${api.join(' AND ')}
           ORDER BY r.occurred_at DESC, r.event_id DESC
           LIMIT ${limitParam})
         UNION ALL
         (SELECT w.occurred_at, w.event_id, w.event_type, a.slug, w.path,
                 NULL::text, NULL::int, NULL::float8,
                 w.tool, w.user_email, w.user_key, NULL::uuid, w.session_id,
                 host(w.ip), w.geo_country, w.geo_city
            FROM traffic.web_events w
            JOIN traffic.apps a ON a.id = w.app_id
           WHERE ${web.join(' AND ')}
           ORDER BY w.occurred_at DESC, w.event_id DESC
           LIMIT ${limitParam})
       ) items
       ORDER BY items.occurred_at DESC, items.event_id DESC
       LIMIT ${limitParam}`,
      params.values,
    );
    return rows;
  }

  // ─── Users ────────────────────────────────────────────────────────────────

  /** Verified users (both tables), most recently seen first, optional email search, offset-paged. */
  async listUsers(
    filter: TrafficFilter,
    options: UserListOptions,
    exec: Executor = this.db,
  ): Promise<UserSummaryRow[]> {
    const { text, values } = userStatsStatement(filter, options);
    const { rows } = await exec.query<UserSummaryRow>(text, values);
    return rows;
  }

  /**
   * Header numbers, top tools, top pages and countries of one stored user_key. Null when the user
   * has no rows in the window (→ 404).
   */
  async getUserProfile(
    userKey: Buffer,
    filter: TrafficFilter,
    exec: Executor = this.db,
  ): Promise<UserProfileRows | null> {
    const { text, values } = userStatsStatement(filter, { userKey, limit: 1, offset: 0 });
    const { rows } = await exec.query<UserSummaryRow>(text, values);
    const summary = rows[0];
    if (!summary) return null;
    const [topTools, topPages, countries] = await Promise.all([
      this.countUserTools(userKey, filter, exec),
      this.countUserPages(userKey, filter, exec),
      this.listUserCountries(userKey, filter, exec),
    ]);
    return { summary, topTools, topPages, countries };
  }

  /**
   * API calls and browser events of one user merged newest first, keyset-paged on
   * (occurred_at, event_id) DESC. `page_time` rows are folded into their page view (`visible_ms`).
   * Each branch is limited before the merge, so a page reads at most 2 × limit rows.
   */
  async listUserTimeline(
    userKey: Buffer,
    filter: TrafficFilter,
    options: TimelineOptions,
    exec: Executor = this.db,
  ): Promise<TimelineEventRow[]> {
    const params = new ParamList();
    const key = params.add(userKey);
    const api = [...windowConditions('r', filter, params), `r.user_key = ${key}`];
    const web = [
      ...windowConditions('w', filter, params),
      `w.user_key = ${key}`,
      `w.event_type <> '${PAGE_TIME}'`,
    ];
    if (options.after) {
      api.push(olderThan('r', options.after, params));
      web.push(olderThan('w', options.after, params));
    }
    const visibleMs = pageViewVisibleMs(filter, params);
    const limit = params.add(options.limit);
    const { rows } = await exec.query<TimelineEventRow>(
      `SELECT * FROM (
         (SELECT r.occurred_at, ${keysetTimeExpr('r.occurred_at')} AS occurred_at_key, r.event_id,
                 '${API_KIND}'::text AS kind, a.slug AS app_slug, r.path, r.session_id,
                 r.identity_source, r.method, r.status_code::int AS status_code,
                 r.duration_ms::float8 AS duration_ms, NULL::text AS tool,
                 NULL::bigint AS visible_ms, NULL::text AS name, r.endpoint_id,
                 host(r.ip) AS ip
            FROM traffic.api_requests r
            JOIN traffic.apps a ON a.id = r.app_id
           WHERE ${api.join(' AND ')}
           ORDER BY r.occurred_at DESC, r.event_id DESC
           LIMIT ${limit})
         UNION ALL
         (SELECT w.occurred_at, ${keysetTimeExpr('w.occurred_at')}, w.event_id,
                 w.event_type, a.slug, w.path, w.session_id,
                 w.identity_source, NULL::text, NULL::int,
                 NULL::float8, w.tool,
                 ${visibleMs}, w.name, NULL::uuid, host(w.ip)
            FROM traffic.web_events w
            JOIN traffic.apps a ON a.id = w.app_id
           WHERE ${web.join(' AND ')}
           ORDER BY w.occurred_at DESC, w.event_id DESC
           LIMIT ${limit})
       ) items
       ORDER BY items.occurred_at DESC, items.event_id DESC
       LIMIT ${limit}`,
      params.values,
    );
    return rows;
  }

  // ─── Journeys ─────────────────────────────────────────────────────────────

  /** Sessions (app, session_id), most recently active first, optionally of one user, offset-paged. */
  async listSessions(
    filter: TrafficFilter,
    options: SessionListOptions,
    exec: Executor = this.db,
  ): Promise<SessionSummaryRow[]> {
    const { text, values } = sessionStatsStatement(filter, options);
    const { rows } = await exec.query<SessionSummaryRow>(text, values);
    return rows;
  }

  /**
   * Header + browser events (SESSION_ORDER, page_time folded into page views) + the API calls
   * correlated by (app_id, session_id). Null when the session has no browser events in the window.
   */
  async getSession(
    appId: string,
    sessionId: string,
    filter: TrafficFilter,
    exec: Executor = this.db,
  ): Promise<SessionRows | null> {
    const scoped: TrafficFilter = { ...filter, appId };
    const { text, values } = sessionStatsStatement(scoped, { sessionId, limit: 1, offset: 0 });
    const { rows } = await exec.query<SessionSummaryRow>(text, values);
    const summary = rows[0];
    if (!summary) return null;
    const [browserEvents, apiCalls] = await Promise.all([
      this.listSessionBrowserEvents(sessionId, scoped, exec),
      this.listSessionApiCalls(sessionId, scoped, exec),
    ]);
    return { summary, browserEvents, apiCalls };
  }

  /**
   * The most common 3-page sequences (path templates, consecutive page views of one session).
   * An immediate repeat of the same page (reload) is collapsed first, so A → A → B is A → B.
   */
  async listTopPaths(
    filter: TrafficFilter,
    limit: number,
    exec: Executor = this.db,
  ): Promise<TopPathRow[]> {
    const params = new ParamList();
    const where = [...windowConditions('w', filter, params), IS_PAGE_VIEW].join(' AND ');
    const { rows } = await exec.query<TopPathRow>(
      `WITH views AS (
         SELECT w.app_id, w.session_id, w.seq, w.occurred_at, w.event_id, w.path_template,
                lag(w.path_template) OVER (
                  PARTITION BY w.app_id, w.session_id ORDER BY ${SESSION_ORDER}
                ) AS previous_path
           FROM traffic.web_events w
          WHERE ${where}
       ), steps AS (
         SELECT v.app_id, v.session_id, v.path_template AS step1,
                lead(v.path_template, 1) OVER s AS step2,
                lead(v.path_template, 2) OVER s AS step3
           FROM views v
          WHERE v.previous_path IS DISTINCT FROM v.path_template
         WINDOW s AS (PARTITION BY v.app_id, v.session_id ORDER BY v.seq, v.occurred_at, v.event_id)
       )
       SELECT a.slug AS app_slug, s.step1, s.step2, s.step3,
              count(DISTINCT s.session_id) AS sessions
         FROM steps s
         JOIN traffic.apps a ON a.id = s.app_id
        WHERE s.step3 IS NOT NULL
        GROUP BY a.slug, s.step1, s.step2, s.step3
        ORDER BY sessions DESC, a.slug, s.step1, s.step2, s.step3
        LIMIT ${params.add(limit)}`,
      params.values,
    );
    return rows;
  }

  // ─── Pages & Tools ────────────────────────────────────────────────────────

  /**
   * Per (app, path template): page views, distinct sessions, avg/p50 of Σ visible_ms per page view
   * (page views without any page_time are left out of avg/p50) and exits (sessions whose LAST page
   * view in the window was this page). Most viewed first.
   */
  async listPageStats(
    filter: TrafficFilter,
    limit: number,
    exec: Executor = this.db,
  ): Promise<PageStatsRow[]> {
    const params = new ParamList();
    const views = [...windowConditions('w', filter, params), IS_PAGE_VIEW].join(' AND ');
    const times = [...windowConditions('w', filter, params), `w.event_type = '${PAGE_TIME}'`].join(
      ' AND ',
    );
    const { rows } = await exec.query<PageStatsRow>(
      `WITH views AS (
         SELECT w.app_id, w.session_id, w.path_template, w.event_id, w.seq, w.occurred_at
           FROM traffic.web_events w
          WHERE ${views}
       ), visible AS (
         SELECT w.page_view_id, sum(w.visible_ms) AS visible_ms
           FROM traffic.web_events w
          WHERE ${times}
          GROUP BY w.page_view_id
       ), exits AS (
         SELECT DISTINCT ON (v.app_id, v.session_id) v.app_id, v.path_template
           FROM views v
          ORDER BY v.app_id, v.session_id, v.seq DESC, v.occurred_at DESC, v.event_id DESC
       ), exit_counts AS (
         SELECT e.app_id, e.path_template, count(*) AS exits
           FROM exits e
          GROUP BY e.app_id, e.path_template
       ), stats AS (
         SELECT v.app_id, v.path_template,
                count(*) AS views,
                count(DISTINCT v.session_id) AS unique_sessions,
                avg(t.visible_ms) AS avg_visible_ms,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY t.visible_ms) AS p50_visible_ms
           FROM views v
           LEFT JOIN visible t ON t.page_view_id = v.event_id
          GROUP BY v.app_id, v.path_template
       )
       SELECT a.slug AS app_slug, s.path_template, s.views, s.unique_sessions,
              s.avg_visible_ms, s.p50_visible_ms, coalesce(e.exits, 0) AS exits
         FROM stats s
         JOIN traffic.apps a ON a.id = s.app_id
         LEFT JOIN exit_counts e ON e.app_id = s.app_id AND e.path_template = s.path_template
        ORDER BY s.views DESC, a.slug ASC, s.path_template ASC
        LIMIT ${params.add(limit)}`,
      params.values,
    );
    return rows;
  }

  /**
   * The most used tools (uses, distinct verified users, distinct sessions, last use) and, for
   * exactly those tools, uses per IST-aligned bucket of `grain` (gaps are filled by the service).
   */
  async listToolUsage(
    filter: TrafficFilter,
    grain: Grain,
    limit: number,
    exec: Executor = this.db,
  ): Promise<ToolUsageRows> {
    const params = new ParamList();
    const where = [...windowConditions('w', filter, params), IS_TOOL_USE].join(' AND ');
    const { rows: tools } = await exec.query<ToolUsageRow>(
      `SELECT w.app_id, a.slug AS app_slug, w.tool,
              count(*) AS uses,
              count(DISTINCT w.user_key) AS distinct_users,
              count(DISTINCT w.session_id) AS distinct_sessions,
              max(w.occurred_at) AS last_used_at
         FROM traffic.web_events w
         JOIN traffic.apps a ON a.id = w.app_id
        WHERE ${where}
        GROUP BY w.app_id, a.slug, w.tool
        ORDER BY uses DESC, a.slug ASC, w.tool ASC
        LIMIT ${params.add(limit)}`,
      params.values,
    );
    if (tools.length === 0) return { tools, trend: [] };
    const trend = await this.toolTrend(tools, filter, grain, exec);
    return { tools, trend };
  }

  // ─── Geography ────────────────────────────────────────────────────────────

  /** API calls + page views + verified users per country (null = unknown/private IP). */
  async listCountries(
    filter: TrafficFilter,
    limit: number,
    exec: Executor = this.db,
  ): Promise<GeoCountryRow[]> {
    const { text, values } = geoStatement('country', filter, limit);
    const { rows } = await exec.query<GeoCountryRow>(text, values);
    return rows;
  }

  /** Same per (country, region, city), with the GeoLite2 city centroid (approximate). */
  async listCities(
    filter: TrafficFilter,
    limit: number,
    exec: Executor = this.db,
  ): Promise<GeoCityRow[]> {
    const { text, values } = geoStatement('city', filter, limit);
    const { rows } = await exec.query<GeoCityRow>(text, values);
    return rows;
  }

  // ─── Building blocks of the composite methods ─────────────────────────────

  /** A user's most used tools (profile). */
  private async countUserTools(
    userKey: Buffer,
    filter: TrafficFilter,
    exec: Executor,
  ): Promise<UserToolCountRow[]> {
    const params = new ParamList();
    const where = [
      ...windowConditions('w', filter, params),
      `w.user_key = ${params.add(userKey)}`,
      IS_TOOL_USE,
    ];
    const { rows } = await exec.query<UserToolCountRow>(
      `SELECT a.slug AS app_slug, w.tool, count(*) AS uses
         FROM traffic.web_events w
         JOIN traffic.apps a ON a.id = w.app_id
        WHERE ${where.join(' AND ')}
        GROUP BY a.slug, w.tool
        ORDER BY uses DESC, a.slug ASC, w.tool ASC
        LIMIT ${params.add(PROFILE_TOP_LIMIT)}`,
      params.values,
    );
    return rows;
  }

  /** A user's most viewed pages (profile). */
  private async countUserPages(
    userKey: Buffer,
    filter: TrafficFilter,
    exec: Executor,
  ): Promise<UserPageCountRow[]> {
    const params = new ParamList();
    const where = [
      ...windowConditions('w', filter, params),
      `w.user_key = ${params.add(userKey)}`,
      IS_PAGE_VIEW,
    ];
    const { rows } = await exec.query<UserPageCountRow>(
      `SELECT a.slug AS app_slug, w.path_template, count(*) AS views
         FROM traffic.web_events w
         JOIN traffic.apps a ON a.id = w.app_id
        WHERE ${where.join(' AND ')}
        GROUP BY a.slug, w.path_template
        ORDER BY views DESC, a.slug ASC, w.path_template ASC
        LIMIT ${params.add(PROFILE_TOP_LIMIT)}`,
      params.values,
    );
    return rows;
  }

  /** Countries a user was seen in (both tables), most frequent first. */
  private async listUserCountries(
    userKey: Buffer,
    filter: TrafficFilter,
    exec: Executor,
  ): Promise<string[]> {
    const params = new ParamList();
    const key = params.add(userKey);
    const api = [...windowConditions('r', filter, params), `r.user_key = ${key}`];
    const web = [...windowConditions('w', filter, params), `w.user_key = ${key}`];
    const { rows } = await exec.query<{ country: string }>(
      `SELECT h.country
         FROM (
           SELECT r.geo_country AS country FROM traffic.api_requests r
            WHERE ${api.join(' AND ')} AND r.geo_country IS NOT NULL
           UNION ALL
           SELECT w.geo_country FROM traffic.web_events w
            WHERE ${web.join(' AND ')} AND w.geo_country IS NOT NULL
         ) h
        GROUP BY h.country
        ORDER BY count(*) DESC, h.country ASC
        LIMIT ${params.add(PROFILE_TOP_LIMIT)}`,
      params.values,
    );
    return rows.map((row) => row.country);
  }

  /** Browser events of one session in replay order, page_time folded into page views. */
  private async listSessionBrowserEvents(
    sessionId: string,
    filter: TrafficFilter,
    exec: Executor,
  ): Promise<SessionEventRow[]> {
    const params = new ParamList();
    const where = [
      ...windowConditions('w', filter, params),
      `w.session_id = ${params.add(sessionId)}`,
      `w.event_type <> '${PAGE_TIME}'`,
    ];
    const { rows } = await exec.query<SessionEventRow>(
      `SELECT w.event_id, w.occurred_at, w.seq, w.event_type AS kind, w.path, w.tool,
              ${pageViewVisibleMs(filter, params)} AS visible_ms, w.name,
              NULL::text AS method, NULL::int AS status_code, NULL::float8 AS duration_ms,
              NULL::uuid AS endpoint_id
         FROM traffic.web_events w
        WHERE ${where.join(' AND ')}
        ORDER BY ${SESSION_ORDER}
        LIMIT ${params.add(SESSION_EVENT_LIMIT)}`,
      params.values,
    );
    return rows;
  }

  /** API calls correlated to one session (same app + session_id), oldest first. */
  private async listSessionApiCalls(
    sessionId: string,
    filter: TrafficFilter,
    exec: Executor,
  ): Promise<SessionEventRow[]> {
    const params = new ParamList();
    const where = [
      ...windowConditions('r', filter, params),
      `r.session_id = ${params.add(sessionId)}`,
    ];
    const { rows } = await exec.query<SessionEventRow>(
      `SELECT r.event_id, r.occurred_at, NULL::int AS seq, '${API_KIND}'::text AS kind, r.path,
              NULL::text AS tool, NULL::bigint AS visible_ms, NULL::text AS name, r.method,
              r.status_code::int AS status_code, r.duration_ms::float8 AS duration_ms,
              r.endpoint_id
         FROM traffic.api_requests r
        WHERE ${where.join(' AND ')}
        ORDER BY r.occurred_at, r.event_id
        LIMIT ${params.add(SESSION_EVENT_LIMIT)}`,
      params.values,
    );
    return rows;
  }

  /** Uses per bucket of the given (app_id, tool) pairs. */
  private async toolTrend(
    tools: readonly ToolUsageRow[],
    filter: TrafficFilter,
    grain: Grain,
    exec: Executor,
  ): Promise<ToolTrendRow[]> {
    const params = new ParamList();
    const where = [
      ...windowConditions('w', filter, params),
      IS_TOOL_USE,
      `(w.app_id, w.tool) IN (
         SELECT * FROM unnest(${params.add(tools.map((t) => t.app_id))}::uuid[],
                              ${params.add(tools.map((t) => t.tool))}::text[])
       )`,
    ];
    const { rows } = await exec.query<ToolTrendRow>(
      `SELECT w.app_id, w.tool, ${bucketExpr(grain, 'w.occurred_at')} AS bucket, count(*) AS uses
         FROM traffic.web_events w
        WHERE ${where.join(' AND ')}
        GROUP BY 1, 2, 3
        ORDER BY 1, 2, 3`,
      params.values,
    );
    return rows;
  }
}
