/**
 * The first step of every analytics service: dashboard time query → concrete window → repository
 * filters (current + previous window), with the range cap of the query's cost class.
 *
 * WHY: `resolveTimeWindow` (@nexus/shared) is pure and throws a plain TimeWindowError; this module
 * is the ONE place that error becomes an HTTP error (400 RANGE_TOO_LARGE / 400 VALIDATION_ERROR),
 * so the Overview, Routes and Errors services cannot drift apart.
 */
import {
  ERROR_CODES,
  resolveTimeWindow,
  TimeWindowError,
  type ResolvedTimeWindow,
  type TimeWindowDto,
  type TimeWindowInput,
} from '@nexus/shared';

import type { TrafficFilter } from '../domain/filters';
import { BadRequestError, ValidationError } from '../errors/app-error';

/**
 * resolveTimeWindow with HTTP semantics. `maxRangeMs` is MAX_PERCENTILE_RANGE_MS for queries that
 * compute percentiles and MAX_COUNT_RANGE_MS for plain counts/lists.
 */
export function resolveQueryWindow(
  query: TimeWindowInput,
  now: Date,
  maxRangeMs: number,
): ResolvedTimeWindow {
  try {
    return resolveTimeWindow(query, now, maxRangeMs);
  } catch (err) {
    throw toWindowHttpError(err);
  }
}

/** TimeWindowError → AppError; anything else is rethrown untouched. */
export function toWindowHttpError(err: unknown): unknown {
  if (!(err instanceof TimeWindowError)) return err;
  return err.reason === 'tooLarge'
    ? new BadRequestError(err.message, ERROR_CODES.RANGE_TOO_LARGE)
    : new ValidationError(err.message, [{ path: 'from', message: err.message }]);
}

/** The window echoed in every response, so charts can label their axis. */
export function toTimeWindowDto(window: ResolvedTimeWindow): TimeWindowDto {
  return { from: window.from.toISOString(), to: window.to.toISOString(), grain: window.grain };
}

/** Repository filter over the selected window. */
export function currentFilter(
  window: ResolvedTimeWindow,
  appId: string | undefined,
): TrafficFilter {
  return { from: window.from, to: window.to, appId };
}

/** Repository filter over the previous equal-length window (KPI deltas). */
export function previousFilter(
  window: ResolvedTimeWindow,
  appId: string | undefined,
): TrafficFilter {
  return { from: window.previousFrom, to: window.previousTo, appId };
}
