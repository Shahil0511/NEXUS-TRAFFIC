import type { MetricDto, TimeWindowDto, TimeseriesPointDto } from './common';

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
  /** % of events (API calls + browser events) carrying a VERIFIED user; null without events. */
  identifiedPct: number | null;
  /** % of API calls linked to a browser session (tracker header); null without API calls. */
  linkedPct: number | null;
}

/** GET ROUTES.overview.timeseries */
export interface OverviewTimeseriesDto {
  window: TimeWindowDto;
  points: TimeseriesPointDto[];
}
