/**
 * Query/param schemas of the analytics endpoints, one per ROUTES leaf (named <leaf><Group>…Schema).
 * The API validates with them (validateQuery/validateParams) and the web client types its calls with
 * the inferred types — one definition for both sides of the HTTP boundary.
 */
import { z } from 'zod';

import { appSlugSchema, pageQueryShape, SORT_DIRECTION_VALUES, timeWindowQuerySchema } from './common';

// ─── overview ───────────────────────────────────────────────────────────────
export const overviewSummaryQuerySchema = timeWindowQuerySchema;
export type OverviewSummaryQuery = z.infer<typeof overviewSummaryQuerySchema>;

export const overviewTimeseriesQuerySchema = timeWindowQuerySchema;
export type OverviewTimeseriesQuery = z.infer<typeof overviewTimeseriesQuerySchema>;

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

export const errorSummaryQuerySchema = timeWindowQuerySchema;
export type ErrorSummaryQuery = z.infer<typeof errorSummaryQuerySchema>;

export const errorListQuerySchema = timeWindowQuerySchema.safeExtend({
  statusClass: z.enum(STATUS_CLASS_VALUES).default('all'),
  endpointId: z.uuid().optional(),
  ...pageQueryShape,
});
export type ErrorListQuery = z.infer<typeof errorListQuerySchema>;

// ─── users ──────────────────────────────────────────────────────────────────
/** userKey = hex HMAC-SHA256 of the email (64 chars). */
export const userKeySchema = z.string().regex(/^[0-9a-f]{64}$/, 'invalid user key');

export const userListQuerySchema = timeWindowQuerySchema.safeExtend({
  search: z.string().trim().max(100).optional(),
  ...pageQueryShape,
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

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

export const geoQuerySchema = timeWindowQuerySchema.safeExtend({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type GeoQuery = z.infer<typeof geoQuerySchema>;

// ─── live ───────────────────────────────────────────────────────────────────
export const liveFilterSchema = z.object({ app: appSlugSchema.optional() });
export type LiveFilterQuery = z.infer<typeof liveFilterSchema>;

export const liveSnapshotQuerySchema = liveFilterSchema;
export type LiveSnapshotQuery = z.infer<typeof liveSnapshotQuerySchema>;
