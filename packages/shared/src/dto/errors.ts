import type { StatusCountDto, TimeWindowDto, TimeseriesPointDto, UserUsageDto } from './common';
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
  /** Distinct verified users who got at least one failed response. */
  usersAffected: number;
  /** The users hit by the most failures (`count` = failed requests). */
  topAffectedUsers: UserUsageDto[];
}
