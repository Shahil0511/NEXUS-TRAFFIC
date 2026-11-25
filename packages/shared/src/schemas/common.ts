/**
 * Reusable query/param schemas for dashboard endpoints.
 * Query strings arrive as strings, so numbers use z.coerce.
 */
import { z } from 'zod';

import { APP_SLUG_PATTERN } from '../constants/ingest';
import { DEFAULT_RANGE, RANGE_VALUES } from '../constants/time';
import { ENVIRONMENT_FILTER_VALUES } from '../constants/traffic';

export const appSlugSchema = z.string().regex(APP_SLUG_PATTERN, 'invalid app slug');

/**
 * The fields of every analytics query: optional app filter + a range preset or a custom from/to +
 * the environment filter. `env` is `.optional()` (NOT `.default()`): absent means
 * DEFAULT_ENVIRONMENT, applied in the API, so the inferred TimeWindowQuery literals across the repo
 * keep compiling. WHY a plain shape: `timeWindowQuerySchema` is refined, and a refined zod object
 * cannot be `.pick()`ed; a schema that needs only some of these fields builds from the shape.
 */
export const timeWindowShape = {
  app: appSlugSchema.optional(),
  range: z.enum(RANGE_VALUES).default(DEFAULT_RANGE),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  env: z.enum(ENVIRONMENT_FILTER_VALUES).optional(),
};

/** Every analytics query: the shape above, with from/to required for `range=custom`. */
export const timeWindowQuerySchema = z
  .object(timeWindowShape)
  .refine((q) => q.range !== 'custom' || (q.from !== undefined && q.to !== undefined), {
    message: 'range=custom requires from and to',
    path: ['from'],
  });

export type TimeWindowQuery = z.infer<typeof timeWindowQuerySchema>;

/** `YYYY-MM-DD` with a month 01-12 and a day that exists in that month (no 2026-02-30). Pure. */
export function isRealCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * One IST calendar day (REPORTING_TIME_ZONE), written `YYYY-MM-DD`: the day of the one-day view.
 * A date, never a datetime, so the day cannot be read in another time zone.
 */
export const reportingDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'day must be YYYY-MM-DD')
  .refine(isRealCalendarDate, 'invalid day');

export const PAGE_LIMIT_DEFAULT = 50;
export const PAGE_LIMIT_MAX = 200;

/** Opaque cursor + page size. */
export const pageQueryShape = {
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_DEFAULT),
};

export const SORT_DIRECTION_VALUES = ['asc', 'desc'] as const;
export type SortDirection = (typeof SORT_DIRECTION_VALUES)[number];
