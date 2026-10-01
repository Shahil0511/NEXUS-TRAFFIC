'use client';

/**
 * Sort + search of the API Routes table as URL state (`?sort=&dir=&q=`).
 *
 * WHY THE URL: like the global filters, a sorted/filtered table must survive a reload and be
 * shareable. The sort values are the API's whitelist (ENDPOINT_SORT_VALUES), so the URL can never
 * carry a sort key the API would reject — nuqs falls back to the default instead.
 */
import {
  ENDPOINT_SORT_VALUES,
  SORT_DIRECTION_VALUES,
  type EndpointSort,
  type SortDirection,
} from '@nexus/shared';
import { parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import { useCallback } from 'react';

export const DEFAULT_ENDPOINT_SORT: EndpointSort = 'calls';
export const DEFAULT_SORT_DIRECTION: SortDirection = 'desc';

export const endpointListParsers = {
  sort: parseAsStringLiteral(ENDPOINT_SORT_VALUES).withDefault(DEFAULT_ENDPOINT_SORT),
  dir: parseAsStringLiteral(SORT_DIRECTION_VALUES).withDefault(DEFAULT_SORT_DIRECTION),
  q: parseAsString.withDefault(''),
};

export interface EndpointListParams {
  sort: EndpointSort;
  dir: SortDirection;
  search: string;
  setSort: (next: { sort: EndpointSort; dir: SortDirection }) => void;
  setSearch: (search: string) => void;
}

export function useEndpointListParams(): EndpointListParams {
  const [raw, setRaw] = useQueryStates(endpointListParsers);
  const setSort = useCallback(
    (next: { sort: EndpointSort; dir: SortDirection }) => void setRaw(next),
    [setRaw],
  );
  const setSearch = useCallback(
    (search: string) => void setRaw({ q: search.trim() === '' ? null : search }),
    [setRaw],
  );
  return { sort: raw.sort, dir: raw.dir, search: raw.q, setSort, setSearch };
}
