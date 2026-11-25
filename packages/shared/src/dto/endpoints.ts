import type { HttpMethod } from '../constants/traffic';
import type { StatusCountDto, TimeWindowDto, TimeseriesPointDto, UserUsageDto } from './common';
import type { RequestSampleDto } from './requests';

/** GET ROUTES.endpoints.list item — one (app, method, routeTemplate). */
export interface EndpointStatsDto {
  endpointId: string;
  app: string;
  method: HttpMethod;
  routeTemplate: string;
  calls: number;
  errors4xx: number;
  errors5xx: number;
  /** Percentage 0..100. */
  errorRate: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  avgMs: number | null;
  lastSeenAt: string;
}

/** GET ROUTES.endpoints.detail */
export interface EndpointDetailDto {
  window: TimeWindowDto;
  endpoint: EndpointStatsDto;
  timeseries: TimeseriesPointDto[];
  statusBreakdown: StatusCountDto[];
  /**
   * The slowest single requests (each with its caller). null when the viewer is not a dashboard
   * admin (ADR 0019); the stats and charts are for everyone.
   */
  slowest: RequestSampleDto[] | null;
  /** Distinct verified users who called the route in the window (for everyone). */
  uniqueUsers: number;
  /**
   * Who calls it most (`count` = calls). null when the viewer is not a dashboard admin
   * (ADR 0019); the count (`uniqueUsers`) is for everyone.
   */
  topUsers: UserUsageDto[] | null;
}
