/**
 * Query/param schemas of the analytics endpoints, one per ROUTES leaf (named <leaf><Group>…Schema).
 * The API validates with them (validateQuery/validateParams) and the web client types its calls with
 * the inferred types — one definition for both sides of the HTTP boundary.
 */
import { z } from 'zod';

import { ERROR_CODE_PATTERN } from '../constants/ingest';
import {
  appSlugSchema,
  pageQueryShape,
  SORT_DIRECTION_VALUES,
  timeWindowQuerySchema,
} from './common';

// ─── overview ───────────────────────────────────────────────────────────────
export const overviewSummaryQuerySchema = timeWindowQuerySchema;
export type OverviewSummaryQuery = z.infer<typeof overviewSummaryQuerySchema>;

export const overviewTimeseriesQuerySchema = timeWindowQuerySchema;
export type OverviewTimeseriesQuery = z.infer<typeof overviewTimeseriesQuerySchema>;

/** The `app` value narrows the list to one row (the application detail page). */
export const overviewAppsQuerySchema = timeWindowQuerySchema;
export type OverviewAppsQuery = z.infer<typeof overviewAppsQuerySchema>;

// ─── endpoints ──────────────────────────────────────────────────────────────
export const ENDPOINT_SORT_VALUES = ['calls', 'errorRate', 'p50', 'p95', 'p99', 'avg'] as const;
export type EndpointSort = (typeof ENDPOINT_SORT_VALUES)[number];

export const endpointListQuerySchema = timeWindowQuerySchema.safeExtend({
  sort: z.enum(ENDPOINT_SORT_VALUES).default('calls'),
  dir: z.enum(SORT_DIRECTION_VALUES).default('desc'),
  search: z.string().trim().max(100).optional(),
  ...pageQueryShape,
});
export type EndpointListQuery = z.infer<typeof endpointListQuerySchema>;

export const endpointDetailParamsSchema = z.object({ endpointId: z.uuid() });
export type EndpointDetailParams = z.infer<typeof endpointDetailParamsSchema>;
export const endpointDetailQuerySchema = timeWindowQuerySchema;
export type EndpointDetailQuery = z.infer<typeof endpointDetailQuerySchema>;

// ─── errors ─────────────────────────────────────────────────────────────────
export const STATUS_CLASS_VALUES = ['all', '4xx', '5xx'] as const;
export type StatusClass = (typeof STATUS_CLASS_VALUES)[number];

/** userKey = hex HMAC-SHA256 of the email (64 chars). */
export const userKeySchema = z.string().regex(/^[0-9a-f]{64}$/, 'invalid user key');

/**
 * One app error code (`error_code` as ingested: ERROR_CODE_PATTERN, the DB CHECK of 0004) — the
 * same rule as the ingest, so a code shown on the dashboard is always a valid filter value.
 */
export const errorCodeSchema = z.string().regex(ERROR_CODE_PATTERN, 'invalid error code');

/**
 * `endpointId` / `userKey` / `errorCode` scope the totals, chart and status codes to one route /
 * one user / one app error code (Errors opened from a route or from a user's "View failures", or
 * a click on an error code).
 */
export const errorSummaryQuerySchema = timeWindowQuerySchema.safeExtend({
  endpointId: z.uuid().optional(),
  userKey: userKeySchema.optional(),
  errorCode: errorCodeSchema.optional(),
});
export type ErrorSummaryQuery = z.infer<typeof errorSummaryQuerySchema>;

export const errorListQuerySchema = timeWindowQuerySchema.safeExtend({
  statusClass: z.enum(STATUS_CLASS_VALUES).default('all'),
  endpointId: z.uuid().optional(),
  userKey: userKeySchema.optional(),
  errorCode: errorCodeSchema.optional(),
  ...pageQueryShape,
});
export type ErrorListQuery = z.infer<typeof errorListQuerySchema>;

// ─── users ──────────────────────────────────────────────────────────────────
/** Sort keys of the Users table (whitelisted ORDER BY in the repository). */
export const USER_SORT_VALUES = [
  'lastSeen',
  'firstSeen',
  'requests',
  'pageViews',
  'sessions',
  'failed',
] as const;
export type UserSort = (typeof USER_SORT_VALUES)[number];

const userListShape = {
  sort: z.enum(USER_SORT_VALUES).default('lastSeen'),
  dir: z.enum(SORT_DIRECTION_VALUES).default('desc'),
  ...pageQueryShape,
};

/** No `search` here: an email must never be in a URL — searching is ROUTES.users.search (POST). */
export const userListQuerySchema = timeWindowQuerySchema.safeExtend(userListShape);
export type UserListQuery = z.infer<typeof userListQuerySchema>;

/** BODY of ROUTES.users.search: the list query plus the email substring (ADR 0006). */
export const userSearchBodySchema = timeWindowQuerySchema.safeExtend({
  search: z.string().trim().min(1).max(100),
  ...userListShape,
});
export type UserSearchBody = z.infer<typeof userSearchBodySchema>;

/** DAU over the window; WAU/MAU end at the window's end. */
export const userActivityQuerySchema = timeWindowQuerySchema;
export type UserActivityQuery = z.infer<typeof userActivityQuerySchema>;

export const userKeyParamsSchema = z.object({ userKey: userKeySchema });
export type UserKeyParams = z.infer<typeof userKeyParamsSchema>;

export const userProfileQuerySchema = timeWindowQuerySchema;
export type UserProfileQuery = z.infer<typeof userProfileQuerySchema>;

export const userTimelineQuerySchema = timeWindowQuerySchema.safeExtend({ ...pageQueryShape });
export type UserTimelineQuery = z.infer<typeof userTimelineQuerySchema>;

// ─── journeys ───────────────────────────────────────────────────────────────
export const sessionListQuerySchema = timeWindowQuerySchema.safeExtend({
  userKey: userKeySchema.optional(),
  ...pageQueryShape,
});
export type SessionListQuery = z.infer<typeof sessionListQuerySchema>;

export const sessionParamsSchema = z.object({ app: appSlugSchema, sessionId: z.uuid() });
export type SessionParams = z.infer<typeof sessionParamsSchema>;
/**
 * The window the replay reads (partition pruning). The session's app comes from the PATH; an `app`
 * query value is accepted (the global filter sends it) but ignored.
 */
export const sessionQuerySchema = timeWindowQuerySchema;
export type SessionQuery = z.infer<typeof sessionQuerySchema>;

export const topPathsQuerySchema = timeWindowQuerySchema.safeExtend({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type TopPathsQuery = z.infer<typeof topPathsQuerySchema>;

// ─── pages / tools / geo ────────────────────────────────────────────────────
export const pageListQuerySchema = timeWindowQuerySchema.safeExtend({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type PageListQuery = z.infer<typeof pageListQuerySchema>;

export const toolUsageQuerySchema = timeWindowQuerySchema.safeExtend({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ToolUsageQuery = z.infer<typeof toolUsageQuerySchema>;

/** A page is addressed by its registered app slug + opaque pageId (never the template). */
export const pageDetailParamsSchema = z.object({ app: appSlugSchema, pageId: z.uuid() });
export type PageDetailParams = z.infer<typeof pageDetailParamsSchema>;
/** The window; the PATH app wins over an `app` query value (accepted, ignored). */
export const pageDetailQuerySchema = timeWindowQuerySchema;
export type PageDetailQuery = z.infer<typeof pageDetailQuerySchema>;

/** A tool is addressed by its registered app slug + opaque toolId (never the tool name). */
export const toolDetailParamsSchema = z.object({ app: appSlugSchema, toolId: z.uuid() });
export type ToolDetailParams = z.infer<typeof toolDetailParamsSchema>;
export const toolDetailQuerySchema = timeWindowQuerySchema;
export type ToolDetailQuery = z.infer<typeof toolDetailQuerySchema>;

export const geoQuerySchema = timeWindowQuerySchema.safeExtend({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type GeoQuery = z.infer<typeof geoQuerySchema>;

// ─── live ───────────────────────────────────────────────────────────────────
export const liveFilterSchema = z.object({ app: appSlugSchema.optional() });
export type LiveFilterQuery = z.infer<typeof liveFilterSchema>;

export const liveSnapshotQuerySchema = liveFilterSchema;
export type LiveSnapshotQuery = z.infer<typeof liveSnapshotQuerySchema>;
