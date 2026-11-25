'use client';

/**
 * Sort of the Pages table as URL state (`?sort=&dir=`).
 *
 * WHY THE URL: a sorted table must survive a reload and be shareable, like the Request types and
 * People lists. The sort itself runs on the loaded rows (sortPages), not in the API. An unknown
 * `?sort=` or `?dir=` parses to the default, most viewed first, instead of breaking the page.
 */
import { SORT_DIRECTION_VALUES, type SortDirection } from '@nexus/shared';
import { parseAsStringLiteral, useQueryStates } from 'nuqs';
import { useCallback } from 'react';

import { DEFAULT_PAGE_SORT, PAGE_SORT_VALUES, type PageSort } from './pageSort';

/** WHY: the nuqs parsers of the Pages sort (whitelisted values, defaults on anything else). */
export const pageListSortParsers = {
  sort: parseAsStringLiteral(PAGE_SORT_VALUES).withDefault(DEFAULT_PAGE_SORT),
  dir: parseAsStringLiteral(SORT_DIRECTION_VALUES).withDefault('desc'),
};

/** WHY: what the Pages view needs from the URL to sort and to write a header click back. */
export interface PageListSort {
  sort: PageSort;
  dir: SortDirection;
  setSort: (next: { sort: PageSort; dir: SortDirection }) => void;
}

/** WHY: the Pages table's sort, read from and written to `?sort=&dir=`. */
export function usePageListSort(): PageListSort {
  const [raw, setRaw] = useQueryStates(pageListSortParsers);
  const setSort = useCallback(
    (next: { sort: PageSort; dir: SortDirection }) => void setRaw(next),
    [setRaw],
  );
  return { sort: raw.sort, dir: raw.dir, setSort };
}
