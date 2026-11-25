/**
 * Resolve a dashboard time query into a concrete window + bucket grain.
 *
 * WHY: one pure function used by every API analytics service (and unit-tested once), so the
 * Overview, Routes and Errors pages always agree on what "24h" means and which bucket size a
 * chart uses. The previous window (immediately before, same ELAPSED length) feeds KPI deltas.
 */
import {
  GRAIN_RULES,
  MAX_COUNT_RANGE_MS,
  RANGE_DURATIONS_MS,
  REPORTING_UTC_OFFSET_MS,
  type Grain,
  type RangePreset,
} from './constants/time';

export interface TimeWindowInput {
  range: RangePreset;
  from?: string;
  to?: string;
}

export interface ResolvedTimeWindow {
  from: Date;
  to: Date;
  grain: Grain;
  previousFrom: Date;
  previousTo: Date;
  durationMs: number;
  /**
   * End of the part of the window that has already happened: `now` while the window is still
   * running (`today`, a custom range ending in the future), else `to`. Charts fill empty buckets
   * only up to here, so an hour that has not happened yet is never drawn as a real zero.
   */
  elapsedTo: Date;
}

/** Why a window was refused: `tooLarge` maps to RANGE_TOO_LARGE, `invalid` to a validation error. */
export const TIME_WINDOW_ERROR_REASON_VALUES = ['invalid', 'tooLarge'] as const;
export type TimeWindowErrorReason = (typeof TIME_WINDOW_ERROR_REASON_VALUES)[number];

export class TimeWindowError extends Error {
  constructor(
    message: string,
    readonly reason: TimeWindowErrorReason = 'invalid',
  ) {
    super(message);
    this.name = 'TimeWindowError';
  }
}

/** Bucket grain for a window length. */
export function grainFor(durationMs: number): Grain {
  const rule = GRAIN_RULES.find((r) => durationMs <= r.maxRangeMs);
  return rule ? rule.grain : 'day';
}

export function resolveTimeWindow(
  input: TimeWindowInput,
  now: Date,
  maxRangeMs: number = MAX_COUNT_RANGE_MS,
): ResolvedTimeWindow {
  const { from, to } = boundsFor(input, now);
  const durationMs = to.getTime() - from.getTime();
  if (durationMs <= 0) throw new TimeWindowError('"from" must be before "to"');
  if (durationMs > maxRangeMs) {
    throw new TimeWindowError(
      `range too large (max ${Math.round(maxRangeMs / 86_400_000)} days)`,
      'tooLarge',
    );
  }
  const elapsedTo = elapsedEndOf(from, to, now);
  const previousFrom = new Date(from.getTime() - durationMs);
  return {
    from,
    to,
    grain: grainFor(durationMs),
    previousFrom,
    previousTo: previousEndOf(from, previousFrom, elapsedTo),
    durationMs,
    elapsedTo,
  };
}

/** `now` clamped into [from, to]: where the data of the window can end at this moment. */
function elapsedEndOf(from: Date, to: Date, now: Date): Date {
  if (now.getTime() <= from.getTime()) return from;
  return now.getTime() < to.getTime() ? now : to;
}

/**
 * End of the comparison window. A window still running (`today` at 10:00) is compared with the SAME
 * elapsed span before it (yesterday 00:00-10:00), never with a whole finished window, so a KPI
 * delta does not read as a drop only because the day is not over. A finished window (every rolling
 * preset, a past custom range) is compared with the whole window before it.
 */
function previousEndOf(from: Date, previousFrom: Date, elapsedTo: Date): Date {
  const elapsedMs = elapsedTo.getTime() - from.getTime();
  return elapsedMs > 0 ? new Date(previousFrom.getTime() + elapsedMs) : from;
}

function boundsFor(input: TimeWindowInput, now: Date): { from: Date; to: Date } {
  if (input.range === 'custom') {
    if (!input.from || !input.to) throw new TimeWindowError('range=custom requires from and to');
    return { from: new Date(input.from), to: new Date(input.to) };
  }
  if (input.range === 'today') {
    const from = startOfReportingDay(now);
    return { from, to: new Date(from.getTime() + RANGE_DURATIONS_MS.today) };
  }
  return { from: new Date(now.getTime() - RANGE_DURATIONS_MS[input.range]), to: now };
}

/**
 * The window widened to WHOLE IST calendar days: from 00:00 IST of the day `from` falls in up to
 * the 00:00 IST that ends the day the window ends in (`to` exclusive). Per-day facts (the first /
 * last activity of a day) are only true over whole days: a rolling window cut mid-day would report
 * the cut as the start of that day.
 */
export function wholeReportingDays(window: { from: Date; to: Date }): { from: Date; to: Date } {
  const lastInstant = new Date(Math.max(window.from.getTime(), window.to.getTime() - 1));
  return {
    from: startOfReportingDay(window.from),
    to: new Date(startOfReportingDay(lastInstant).getTime() + RANGE_DURATIONS_MS.today),
  };
}

/** 00:00 IST of the calendar day `now` falls in (India has no DST, so a fixed offset is exact). */
export function startOfReportingDay(now: Date): Date {
  const day = RANGE_DURATIONS_MS.today;
  const local = now.getTime() + REPORTING_UTC_OFFSET_MS;
  return new Date(Math.floor(local / day) * day - REPORTING_UTC_OFFSET_MS);
}

// ─── IST calendar days written YYYY-MM-DD (the one-day view) ────────────────

/** `YYYY-MM-DD` → [year, month 1-12, day]; throws on any other text. */
function reportingDayParts(day: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) throw new TimeWindowError(`"${day}" is not a YYYY-MM-DD day`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * The window of ONE IST calendar day: from 00:00 IST of `day` (`YYYY-MM-DD`) to the next 00:00 IST,
 * 24 h later (India has no DST). Pure; the caller validates `day` (reportingDaySchema).
 */
export function reportingDayWindow(day: string): { from: Date; to: Date } {
  const [year, month, date] = reportingDayParts(day);
  const from = new Date(Date.UTC(year, month - 1, date) - REPORTING_UTC_OFFSET_MS);
  return { from, to: new Date(from.getTime() + RANGE_DURATIONS_MS.today) };
}

/** The IST calendar day (`YYYY-MM-DD`) an instant falls in: 18:29:59Z is still that day, 18:30Z the next. */
export function reportingDayOf(instant: Date): string {
  return new Date(instant.getTime() + REPORTING_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

/** `day` moved by `n` calendar days (negative = back): 2026-11-30 + 1 → 2026-12-01. Pure. */
export function addReportingDays(day: string, n: number): string {
  const [year, month, date] = reportingDayParts(day);
  return new Date(Date.UTC(year, month - 1, date + n)).toISOString().slice(0, 10);
}
