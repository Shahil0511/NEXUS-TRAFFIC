import type { BreakdownDimension, IngestSource } from '../constants/traffic';
import type { MetricDto, TimeWindowDto, TimeseriesPointDto, WindowedListDto } from './common';

/** GET ROUTES.overview.summary */
export interface OverviewSummaryDto {
  window: TimeWindowDto;
  requests: MetricDto;
  /** Percentage 0..100 of requests with status >= 400. */
  errorRate: MetricDto;
  p95Ms: MetricDto;
  pageViews: MetricDto;
  /** Distinct verified users over API calls + browser events (same definition as the Users page). */
  identifiedUsers: MetricDto;
  /** Distinct users/sessions seen in the last 5 minutes (not window-bound). */
  activeUsersNow: number;
}

/**
 * GET ROUTES.overview.apps item (WindowedListDto) — one row per REGISTERED app, busiest first;
 * an app without traffic in the window has zeros and null `lastEventAt`, so a silent integration
 * is visible. `users` = distinct verified users over API calls + browser events (same definition
 * as the Users page); `sessions` = browser sessions (same definition as Journeys).
 */
export interface AppTrafficDto {
  app: string;
  displayName: string;
  requests: MetricDto;
  /** Percentage 0..100 of requests with status >= 400. */
  errorRate: MetricDto;
  /** p95 over the window (http only); null without http calls. */
  p95Ms: number | null;
  pageViews: MetricDto;
  users: MetricDto;
  sessions: number;
  toolUses: number;
  /** Newest API call or browser event in the window. */
  lastEventAt: string | null;
  /**
   * % of events carrying a VERIFIED user — both sources combined (API calls + browser events);
   * null without events. Integration Health shows the same predicate PER SOURCE.
   */
  identifiedPct: number | null;
  /**
   * % of linkable (browser-originated http) API calls linked to a browser session (tracker
   * header); null without linkable API calls. SSR, server-to-server calls, bots and streams are
   * not linkable and are left out of the denominator.
   */
  linkedPct: number | null;
}

/** GET ROUTES.overview.timeseries */
export interface OverviewTimeseriesDto {
  window: TimeWindowDto;
  points: TimeseriesPointDto[];
}

/** One value of a breakdown. `value` null = the column was empty (e.g. no release sent). */
export interface BreakdownItemDto {
  value: string | null;
  events: number;
  /** Share 0..1 of `total`. */
  share: number;
}

/** GET ROUTES.overview.breakdown — top values of one dimension, busiest first. */
export interface BreakdownDto extends WindowedListDto<BreakdownItemDto> {
  source: IngestSource;
  dimension: BreakdownDimension;
  /** Events in the window (all values, not just the listed top N). */
  total: number;
}

/**
 * GET ROUTES.overview.devices — devices (distinct anonymous_id on page views) in the window;
 * `returningDevices` were also seen in [lookbackFrom, window.from), the rest are new.
 */
export interface DeviceReturnDto {
  window: TimeWindowDto;
  lookbackFrom: string;
  devices: number;
  newDevices: number;
  returningDevices: number;
}
