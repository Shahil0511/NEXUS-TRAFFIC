/**
 * Inputs of the analytics query repositories, already resolved by the services (time window →
 * Dates, app slug → internal id, cursor → offset/keyset).
 *
 * WHY: repositories never see raw query strings or slugs. Every analytics query is bounded by
 * `occurred_at >= from AND occurred_at < to` (partition pruning on the monthly partitions), so the
 * window is REQUIRED here, not optional.
 */
import type { EndpointSort, SortDirection, StatusClass, UserSort } from '@nexus/shared';

/** The window + scope every analytics query runs over. */
export interface TrafficFilter {
  /** Inclusive lower bound. */
  from: Date;
  /** Exclusive upper bound. */
  to: Date;
  /** Internal `apps.id`; undefined = all apps. */
  appId?: string;
  /** Stored `endpoint_id` (one app + method + route template); undefined = all endpoints. */
  endpointId?: string;
  /**
   * Stored `user_key` (bytea) — one verified user. Honoured by ApiRequestQueryRepository (Errors
   * "View failures") and by WebEventQueryRepository's online queries (listOnlineUsers,
   * countOnlineByApp) on BOTH tables; the other web-event queries take the key as an argument.
   */
  userKey?: Buffer;
}

/**
 * The Errors page scope: TrafficFilter plus ONE app error code (`error_code`, ERROR_CODE_PATTERN —
 * validated by errorSummaryQuerySchema / errorListQuerySchema). Always bound as a parameter.
 * WHY a separate type: the code narrows FAILED rows only, never "all calls" (a route's call count
 * must not shrink to its coded failures) — see errorCodeCondition in api-request-query.repository.
 */
export interface FailureFilter extends TrafficFilter {
  /** Stored `error_code`; undefined = every code (and no code). */
  errorCode?: string;
}

/**
 * Sort keys of the endpoint-stats query: the public ENDPOINT_SORT_VALUES plus `errors`, which only
 * the Errors page uses internally ("top failing endpoints") and is NOT accepted from the query string.
 */
export type EndpointStatsOrder = EndpointSort | 'errors';

/** Paging + ordering of `ApiRequestQueryRepository.listEndpointStats`. */
export interface EndpointListOptions {
  sort: EndpointStatsOrder;
  dir: SortDirection;
  /** Case-insensitive substring of the route template. */
  search?: string;
  limit: number;
  offset: number;
}

/** Position of the last row of a raw-event page: `(occurred_at, event_id)`, newest first. */
export interface EventKeyset {
  /**
   * ISO-8601 UTC with microseconds (`keysetTimeExpr` in src/db/sql.ts) — NOT a Date: occurred_at
   * keeps the sender's µs precision and a Date would truncate it to ms (repeated rows).
   */
  occurredAt: string;
  eventId: string;
}

/** Paging + scope of `ApiRequestQueryRepository.listFailures`. */
export interface FailureListOptions {
  statusClass: StatusClass;
  /** Rows strictly older than this keyset; null = first page. */
  after: EventKeyset | null;
  limit: number;
}

/** Paging + search + order of `WebEventQueryRepository.listUsers` (offset: aggregate list). */
export interface UserListOptions {
  /** Case-insensitive substring of the verified email. */
  search?: string;
  /** Whitelisted sort key (USER_SORT_VALUES); default: most recently seen first. */
  sort?: UserSort;
  dir?: SortDirection;
  limit: number;
  offset: number;
}

/** Paging of `WebEventQueryRepository.listUserTimeline` (keyset, newest first). */
export interface TimelineOptions {
  /** Items strictly older than this keyset; null = first page. */
  after: EventKeyset | null;
  limit: number;
}

/** Paging + optional user scope of `WebEventQueryRepository.listSessions` (offset). */
export interface SessionListOptions {
  /** Stored user_key (bytea): only sessions in which this user was seen. */
  userKey?: Buffer;
  limit: number;
  offset: number;
}
