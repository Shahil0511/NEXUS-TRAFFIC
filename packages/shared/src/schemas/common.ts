/**
 * Reusable query/param schemas for dashboard endpoints.
 * Query strings arrive as strings, so numbers use z.coerce.
 */
import { z } from 'zod';

import { APP_SLUG_PATTERN } from '../constants/ingest';
import { DEFAULT_RANGE, RANGE_VALUES } from '../constants/time';

export const appSlugSchema = z.string().regex(APP_SLUG_PATTERN, 'invalid app slug');

/** Every analytics query: optional app filter + a range preset or a custom from/to. */
export const timeWindowQuerySchema = z
  .object({
    app: appSlugSchema.optional(),
    range: z.enum(RANGE_VALUES).default(DEFAULT_RANGE),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((q) => q.range !== 'custom' || (q.from !== undefined && q.to !== undefined), {
    message: 'range=custom requires from and to',
    path: ['from'],
  });

export type TimeWindowQuery = z.infer<typeof timeWindowQuerySchema>;

export const PAGE_LIMIT_DEFAULT = 50;
export const PAGE_LIMIT_MAX = 200;

/** Opaque cursor + page size. */
export const pageQueryShape = {
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_DEFAULT),
};

export const SORT_DIRECTION_VALUES = ['asc', 'desc'] as const;
export type SortDirection = (typeof SORT_DIRECTION_VALUES)[number];
