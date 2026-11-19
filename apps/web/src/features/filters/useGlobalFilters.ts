'use client';

/**
 * The global filters (app + time range + environment) as URL state.
 *
 * WHY THE URL: a filtered view must survive reloads and be shareable as a link; nuqs keeps
 * `?app=&range=&from=&to=&env=` in sync with React state. An absent `env` means production
 * (DEFAULT_ENVIRONMENT, applied by the API — ADR 0008), so prod links stay short. The raw params are validated with the SAME
 * zod schema the API uses (timeWindowQuerySchema), so a hand-edited URL can never produce a query
 * the API rejects — it falls back to the default range instead.
 *
 * @see ../../../../../packages/shared/src/schemas/common.ts   timeWindowQuerySchema
 */
import {
  DEFAULT_ENVIRONMENT,
  DEFAULT_RANGE,
  ENVIRONMENT_FILTER_VALUES,
  RANGE_VALUES,
  timeWindowQuerySchema,
  type EnvironmentFilter,
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
  /** null (absent) = production; an unknown value also parses to null. */
  env: parseAsStringLiteral(ENVIRONMENT_FILTER_VALUES),
};

export interface RawGlobalFilters {
  app: string | null;
  range: RangePreset;
  from: string | null;
  to: string | null;
  env: EnvironmentFilter | null;
}

/**
 * Validate raw URL values into a query the API accepts (pure; unit-tested). The environment
 * survives BOTH fallbacks: a broken range or app must never silently switch staging data to prod.
 */
export function toTimeWindowQuery(raw: RawGlobalFilters): TimeWindowQuery {
  const env = raw.env ?? undefined;
  const candidate = {
    app: raw.app ?? undefined,
    range: raw.range,
    from: raw.range === 'custom' ? (raw.from ?? undefined) : undefined,
    to: raw.range === 'custom' ? (raw.to ?? undefined) : undefined,
    env,
  };
  const parsed = timeWindowQuerySchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  const appOnly = timeWindowQuerySchema.safeParse({
    app: candidate.app,
    range: DEFAULT_RANGE,
    env,
  });
  if (appOnly.success) return appOnly.data;
  return env === undefined ? { range: DEFAULT_RANGE } : { range: DEFAULT_RANGE, env };
}

/** The filter values to carry over when navigating between pages (defaults left out). */
export function filterLinkQuery(filters: TimeWindowQuery): Record<string, string | undefined> {
  return {
    app: filters.app,
    range: filters.range === DEFAULT_RANGE ? undefined : filters.range,
    from: filters.from,
    to: filters.to,
    env: filters.env === DEFAULT_ENVIRONMENT ? undefined : filters.env,
  };
}

export interface GlobalFiltersApi {
  filters: TimeWindowQuery;
  setApp: (slug: string | null) => void;
  setRange: (range: Exclude<RangePreset, 'custom'>) => void;
  setCustomRange: (from: string, to: string) => void;
  /** Production (the default) clears `?env=` so prod links stay short. */
  setEnvironment: (env: EnvironmentFilter) => void;
}

export function useGlobalFilters(): GlobalFiltersApi {
  const [raw, setRaw] = useQueryStates(globalFilterParsers);
  const { app, range, from, to, env } = raw;
  // Memoised on the primitive values so the query key object stays referentially stable.
  const filters = useMemo(
    () => toTimeWindowQuery({ app, range, from, to, env }),
    [app, range, from, to, env],
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
  const setEnvironment = useCallback(
    (next: EnvironmentFilter) => void setRaw({ env: next === DEFAULT_ENVIRONMENT ? null : next }),
    [setRaw],
  );
  return { filters, setApp, setRange, setCustomRange, setEnvironment };
}
