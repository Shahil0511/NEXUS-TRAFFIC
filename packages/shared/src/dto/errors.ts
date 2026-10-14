import type { StatusCountDto, TimeWindowDto, TimeseriesPointDto, UserUsageDto } from './common';
import type { EndpointStatsDto } from './endpoints';

/** Failures sharing one app error code (`error_code` as ingested). */
export interface ErrorCodeCountDto {
  /** The code the app sent (ERROR_CODE_PATTERN); null = failures sent WITHOUT a code. */
  errorCode: string | null;
  /** Failed requests with this code. */
  count: number;
  /** Distinct routes (endpoint ids) that failed with this code. */
  routes: number;
}

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
  /** The most frequent app error codes of the failures (top 10, most first). */
  byErrorCode: ErrorCodeCountDto[];
}
