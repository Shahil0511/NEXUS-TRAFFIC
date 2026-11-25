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
 * One app on one IST day of one person: the day's facts narrowed to that app. First / last
 * activity span BOTH tables; `activeMs` = Σ visible_ms of the app's page_time rows that day (tab
 * visible time), 0 for an app that sends only API calls (no browser tracker).
 */
export interface UserDayAppActivityDto {
  app: string;
  firstActivityAt: string;
  lastActivityAt: string;
  activeMs: number;
  pageViews: number;
  requests: number;
  /** API calls answered with status >= 400. */
  failedRequests: number;
  toolUses: number;
  /** Distinct (app, session) of the app's BROWSER rows that day. */
  visits: number;
}

/**
 * One IST calendar day (REPORTING_TIME_ZONE) on which the user was active. `day` is the instant of
 * that day's IST midnight (ISO, like UserActivityDto points). First / last activity span BOTH
 * tables; `activeMs` = Σ visible_ms of the day's page_time rows (tab-visible time). Every count
 * and `activeMs` is the Σ of `perApp`; first / last are its min / max.
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
  /** Distinct BROWSER sessions of the day, one per (app, session): the Σ of perApp visits. */
  visits: number;
  /** App slugs, sorted (the slugs of `perApp`). */
  apps: string[];
  /**
   * The day has not ended yet (today): its last activity is "so far", so it is left out of the
   * average last activity.
   */
  inProgress: boolean;
  /**
   * The day per app, ordered by the app's first activity (then slug): the order the apps were
   * used in, NEVER by time or counts.
   */
  perApp: UserDayAppActivityDto[];
}

/**
 * GET ROUTES.users.daily — one item per active IST day, newest first; days without activity are
 * omitted. The window is widened to WHOLE IST days (wholeReportingDays) and echoed as such, so a
 * rolling range never cuts a day in half. Empty (not a 404) when the user did nothing.
 */
export type UserDailyActivityDto = WindowedListDto<UserDayActivityDto>;

/**
 * One activity block of a day: a stretch of browser events whose breaks are all shorter than
 * USER_DAY_BLOCK_GAP_MS. A `page_time` row covers the credited time before it (clamped to the
 * day's start), the other events are points. `spanMs` = end − start; spans are never summed.
 */
export interface UserActivityBlockDto {
  startAt: string;
  endAt: string;
  spanMs: number;
  /** Length of the union of the block's page-visible intervals: tabs open at once count once. */
  timeInAppMs: number;
  /** Σ credited page_time deltas of the block (tab visible time): tabs open at once each count. */
  activeMs: number;
  /** App slugs, sorted. */
  apps: string[];
  pageViews: number;
  toolUses: number;
  /** API calls of the person between the block's start and end (any app in scope). */
  requests: number;
}

/** One page (app + path template) seen on the day, in first-view order. */
export interface UserDayPageDto {
  /** toPageId(app, pathTemplate): the page's detail link, never the template in a URL. */
  pageId: string;
  app: string;
  pathTemplate: string;
  /** null when the day has only time ticks of a page view opened the day before. */
  firstViewAt: string | null;
  views: number;
  /** Σ credited page_time deltas of the page that day (tab visible time). */
  activeMs: number;
}

/** One feature (tool) used on the day, in first-use order. */
export interface UserDayToolDto {
  /** toToolId(app, tool): the tool's detail link. */
  toolId: string;
  app: string;
  tool: string;
  firstUseAt: string;
  uses: number;
}

/**
 * One visit (app, session) of the person on the day, the facts of its events INSIDE the day. No
 * IP and no email: the person is known from the page.
 */
export interface UserDayVisitDto {
  app: string;
  sessionId: string;
  startedAt: string;
  lastActivityAt: string;
  entryPath: string | null;
  exitPath: string | null;
  pageViews: number;
  toolUses: number;
  /** Σ credited page_time deltas of the visit that day (tab visible time). */
  activeMs: number;
}

/**
 * GET ROUTES.users.day — ONE IST calendar day of one person (`?day=YYYY-MM-DD`, at most
 * USER_DAY_LOOKBACK_DAYS back, never in the future). The window echoed is that day. A day without
 * activity is a 200 with `summary: null` and empty lists, never a 404.
 */
export interface UserDayDetailDto {
  window: TimeWindowDto;
  /** The day asked for, `YYYY-MM-DD` (IST). */
  day: string;
  /** The day's facts and its per-app split, as one item of ROUTES.users.daily; null = no activity. */
  summary: UserDayActivityDto | null;
  /** Σ timeInAppMs of EVERY block of the day (not only the ones returned). */
  timeInAppMs: number;
  /** In start order, at most USER_DAY_BLOCKS_LIMIT. */
  blocks: UserActivityBlockDto[];
  /** How many blocks the day has in all, also when `blocks` is cut at USER_DAY_BLOCKS_LIMIT. */
  blockCount: number;
  /** The day has more blocks than `blocks` holds (`blockCount > blocks.length`). */
  blocksTruncated: boolean;
  /** API calls of the day that fall in no block (between blocks or with no browser event near). */
  requestsOutsideBlocks: number;
  /** First-view order, at most USER_DAY_PAGES_LIMIT; `pagesTotal` counts them all. */
  pages: UserDayPageDto[];
  pagesTotal: number;
  /** First-use order, at most USER_DAY_TOOLS_LIMIT; `toolsTotal` counts them all. */
  tools: UserDayToolDto[];
  toolsTotal: number;
  /** Newest first, at most USER_DAY_VISITS_LIMIT; the total is `summary.visits`. */
  visits: UserDayVisitDto[];
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
