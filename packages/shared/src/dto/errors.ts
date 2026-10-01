import type { StatusCountDto, TimeWindowDto, TimeseriesPointDto } from './common';
import type { EndpointStatsDto } from './endpoints';

/** GET ROUTES.errors.summary */
export interface ErrorSummaryDto {
  window: TimeWindowDto;
  total: number;
  errors4xx: number;
  errors5xx: number;
  byStatus: StatusCountDto[];
  timeseries: TimeseriesPointDto[];
  topEndpoints: EndpointStatsDto[];
}
