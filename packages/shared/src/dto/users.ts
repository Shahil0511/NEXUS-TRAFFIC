import type { HttpMethod, IdentitySource } from '../constants/traffic';
import type { TimeWindowDto } from './common';

/**
 * GET ROUTES.users.list item (CursorPage). ONLY verified identities (sso_cookie / app_attested)
 * are users; `userKey` is an opaque HMAC of the email — safe in URLs.
 */
export interface UserSummaryDto {
  userKey: string;
  email: string;
  lastSeenAt: string;
  requests: number;
  pageViews: number;
  /** Distinct BROWSER sessions (the ones Journeys can replay). */
  sessions: number;
  /** API calls answered with status >= 400. */
  failedRequests: number;
  /** First activity INSIDE the window (not the first ever). */
  firstSeenAt: string;
  apps: string[];
}

/** One route a user calls (profile "Top API routes"). */
export interface UserEndpointUsageDto {
  endpointId: string;
  app: string;
  method: HttpMethod;
  routeTemplate: string;
  calls: number;
  failed: number;
}

/** A user's activity in ONE app (profile "Apps used"). */
export interface UserAppUsageDto {
  app: string;
  requests: number;
  pageViews: number;
  toolUses: number;
  sessions: number;
  lastSeenAt: string;
}

/** GET ROUTES.users.profile (404 when the user has no activity in the window). */
export interface UserProfileDto {
  summary: UserSummaryDto;
  firstSeenAt: string;
  failedRequests: number;
  topTools: Array<{ toolId: string; app: string; tool: string; uses: number }>;
  topPages: Array<{ pageId: string; app: string; pathTemplate: string; views: number }>;
  topEndpoints: UserEndpointUsageDto[];
  /** One row per app the user was active in, most active first. */
  perApp: UserAppUsageDto[];
  countries: string[];
}

/**
 * GET ROUTES.users.activity — distinct VERIFIED users per IST day over the window (DAU), plus the
 * distinct users of the last 7 / 30 days ending at the window's end (WAU / MAU).
 */
export interface UserActivityDto {
  window: TimeWindowDto;
  points: Array<{ day: string; users: number }>;
  wau: number;
  mau: number;
}

export const TIMELINE_ITEM_KIND_VALUES = [
  'api',
  'page_view',
  'page_time',
  'tool_use',
  'custom',
] as const;
export type TimelineItemKind = (typeof TIMELINE_ITEM_KIND_VALUES)[number];

/**
 * GET ROUTES.users.timeline item (CursorPage, newest first) — API calls and browser events merged
 * by time. `page_time` deltas are folded into their page view (`visibleMs` = Σ visible ms of that
 * page view), so the timeline never lists `page_time` rows.
 */
export interface TimelineItemDto {
  eventId: string;
  occurredAt: string;
  kind: TimelineItemKind;
  app: string;
  path: string;
  sessionId: string | null;
  identitySource: IdentitySource;
  method: string | null;
  status: number | null;
  durationMs: number | null;
  tool: string | null;
  visibleMs: number | null;
  /** `custom` events only. */
  name: string | null;
  /** `api` items only: the stored route (opaque id → the route's page). */
  endpointId: string | null;
  /** ADMINS ONLY; null for every other viewer. */
  ip: string | null;
}
