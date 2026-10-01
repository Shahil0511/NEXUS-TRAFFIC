'use client';

/**
 * The global filters (app + time range) as URL state.
 *
 * WHY THE URL: a filtered view must survive reloads and be shareable as a link; nuqs keeps
 * `?app=&range=&from=&to=` in sync with React state. The raw params are validated with the SAME
 * zod schema the API uses (timeWindowQuerySchema), so a hand-edited URL can never produce a query
 * the API rejects — it falls back to the default range instead.
 *
 * @see ../../../../../packages/shared/src/schemas/common.ts   timeWindowQuerySchema
 */
import {
  DEFAULT_RANGE,
  RANGE_VALUES,
  timeWindowQuerySchema,
  type RangePreset,
  type TimeWindowQuery,
} from '@nexus/shared';
import { parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import { useCallback, useMemo } from 'react';

export const globalFilterParsers = {
  app: parseAsString,
  range: parseAsStringLiteral(RANGE_VALUES).withDefault(DEFAULT_RANGE),
  from: parseAsString,
  to: parseAsString,
};

export interface RawGlobalFilters {
  app: string | null;
  range: RangePreset;
  from: string | null;
  to: string | null;
}

/** Validate raw URL values into a query the API accepts (pure; unit-tested). */
export function toTimeWindowQuery(raw: RawGlobalFilters): TimeWindowQuery {
  const candidate = {
    app: raw.app ?? undefined,
    range: raw.range,
    from: raw.range === 'custom' ? (raw.from ?? undefined) : undefined,
    to: raw.range === 'custom' ? (raw.to ?? undefined) : undefined,
  };
  const parsed = timeWindowQuerySchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  const appOnly = timeWindowQuerySchema.safeParse({ app: candidate.app, range: DEFAULT_RANGE });
  return appOnly.success ? appOnly.data : { range: DEFAULT_RANGE };
}

/** The filter values to carry over when navigating between pages. */
export function filterLinkQuery(filters: TimeWindowQuery): Record<string, string | undefined> {
  return {
    app: filters.app,
    range: filters.range === DEFAULT_RANGE ? undefined : filters.range,
    from: filters.from,
    to: filters.to,
  };
}

export interface GlobalFiltersApi {
  filters: TimeWindowQuery;
  setApp: (slug: string | null) => void;
  setRange: (range: Exclude<RangePreset, 'custom'>) => void;
  setCustomRange: (from: string, to: string) => void;
}

export function useGlobalFilters(): GlobalFiltersApi {
  const [raw, setRaw] = useQueryStates(globalFilterParsers);
  const { app, range, from, to } = raw;
  // Memoised on the primitive values so the query key object stays referentially stable.
  const filters = useMemo(
    () => toTimeWindowQuery({ app, range, from, to }),
    [app, range, from, to],
  );
  const setApp = useCallback((slug: string | null) => void setRaw({ app: slug }), [setRaw]);
  const setRange = useCallback(
    (range: Exclude<RangePreset, 'custom'>) => void setRaw({ range, from: null, to: null }),
    [setRaw],
  );
  const setCustomRange = useCallback(
    (from: string, to: string) => void setRaw({ range: 'custom', from, to }),
    [setRaw],
  );
  return { filters, setApp, setRange, setCustomRange };
}
