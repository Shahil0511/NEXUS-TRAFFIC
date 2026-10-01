import type { HttpMethod } from '../constants/traffic';
import type { StatusCountDto, TimeWindowDto, TimeseriesPointDto } from './common';
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
  slowest: RequestSampleDto[];
}
