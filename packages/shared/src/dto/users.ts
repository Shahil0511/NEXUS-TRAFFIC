import type { HttpMethod, IdentitySource } from '../constants/traffic';
import type { TimeWindowDto, WindowedListDto } from './common';

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
  /**
   * The facts of the latest browser event of the window (the identity card's "Latest known"). Part
   * of the profile, so showing the card is recorded as the profile surface only.
   */
  latest: UserLatestContextDto | null;
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

/**
 * One (device type, browser, operating system) combination a user was seen on in the window,
 * over API calls AND browser events (`ua_device`, `ua_browser`, `ua_os` exist on both). null = not
 * known (no or unparsed User-Agent).
 */
export interface UserDeviceDto {
  device: string | null;
  browser: string | null;
  os: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  pageViews: number;
  requests: number;
  /** Distinct BROWSER sessions on this combination (API calls alone open no visit). */
  visits: number;
  /** App slugs, sorted. */
  apps: string[];
}

/**
 * The facts of the user's MOST RECENT browser event in the window (one row, so the values belong
 * together). null when the user has no browser event in the window (server events only).
 */
export interface UserLatestContextDto {
  seenAt: string;
  app: string;
  device: string | null;
  browser: string | null;
  os: string | null;
  /** IANA time zone the browser reported (`client_tz`). */
  timeZone: string | null;
  /** BCP-47 language the browser reported (`client_lang`). */
  language: string | null;
  /** The frontend release (`release`). */
  appVersion: string | null;
}

/**
 * GET ROUTES.users.devices — the user's devices, most recently used first (at most
 * USER_DEVICES_LIMIT). An empty list (not a 404) when the user has no activity in the window: the
 * profile answers the 404. The latest known facts come with the profile (UserProfileDto.latest).
 */
export type UserDevicesDto = WindowedListDto<UserDeviceDto>;

/**
 * One IST calendar day (REPORTING_TIME_ZONE) on which the user was active. `day` is the instant of
 * that day's IST midnight (ISO, like UserActivityDto points). First / last activity span BOTH
 * tables; `activeMs` = Σ visible_ms of the day's page_time rows (tab-visible time).
 */
export interface UserDayActivityDto {
  day: string;
  firstActivityAt: string;
  lastActivityAt: string;
  activeMs: number;
  pageViews: number;
  requests: number;
  /** API calls answered with status >= 400. */
  failedRequests: number;
  toolUses: number;
  /** Distinct BROWSER sessions of the day. */
  visits: number;
  /** App slugs, sorted. */
  apps: string[];
  /**
   * The day has not ended yet (today): its last activity is "so far", so it is left out of the
   * average last activity.
   */
  inProgress: boolean;
}

/**
 * GET ROUTES.users.daily — one item per active IST day, newest first; days without activity are
 * omitted. The window is widened to WHOLE IST days (wholeReportingDays) and echoed as such, so a
 * rolling range never cuts a day in half. Empty (not a 404) when the user did nothing.
 */
export type UserDailyActivityDto = WindowedListDto<UserDayActivityDto>;

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
