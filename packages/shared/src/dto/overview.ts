import type { MetricDto, TimeWindowDto, TimeseriesPointDto } from './common';

/** GET ROUTES.overview.summary */
export interface OverviewSummaryDto {
  window: TimeWindowDto;
  requests: MetricDto;
  /** Percentage 0..100 of requests with status >= 400. */
  errorRate: MetricDto;
  p95Ms: MetricDto;
  pageViews: MetricDto;
  identifiedUsers: MetricDto;
  /** Distinct users/sessions seen in the last 5 minutes (not window-bound). */
  activeUsersNow: number;
}

/** GET ROUTES.overview.timeseries */
export interface OverviewTimeseriesDto {
  window: TimeWindowDto;
  points: TimeseriesPointDto[];
}
