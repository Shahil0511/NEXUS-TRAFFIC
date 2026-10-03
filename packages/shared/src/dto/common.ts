/**
 * Building blocks reused by several DTOs.
 * All timestamps are ISO-8601 strings in UTC; the dashboard formats them in REPORTING_TIME_ZONE.
 */
import type { Grain } from '../constants/time';
import type { IdentitySource } from '../constants/traffic';

/** Keyset/offset page. `nextCursor` is opaque; null means "no more". */
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/** The resolved window a query ran over (echoed so the UI can label charts). */
export interface TimeWindowDto {
  from: string;
  to: string;
  grain: Grain;
}

/**
 * A short, non-paged list (top N) over a time window: Pages, Tools, Geography, top paths.
 * `window` is echoed so charts (e.g. tool trends) can label their axis.
 */
export interface WindowedListDto<T> {
  window: TimeWindowDto;
  items: T[];
}

/** A KPI with its value over the previous equal-length window. */
export interface MetricDto {
  value: number | null;
  previous: number | null;
  /** (value - previous) / previous * 100; null when previous is 0 or null. */
  deltaPct: number | null;
}

export interface GeoDto {
  country: string | null;
  region: string | null;
  city: string | null;
}

/** One time bucket of a chart. */
export interface TimeseriesPointDto {
  bucket: string;
  requests: number;
  errors4xx: number;
  errors5xx: number;
  p95Ms: number | null;
  pageViews: number;
}

export interface StatusCountDto {
  status: number;
  count: number;
}

/** Who did something. `ip` is null for non-admin viewers (masked by the API mapper). */
export interface ActorDto {
  userKey: string | null;
  userEmail: string | null;
  claimedEmail: string | null;
  identitySource: IdentitySource;
  ip: string | null;
  geo: GeoDto | null;
}
