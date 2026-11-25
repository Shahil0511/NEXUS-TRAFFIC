'use client';

/**
 * Sort of the Features table as URL state (`?sort=&dir=`).
 *
 * WHY THE URL: a sorted table must survive a reload and be shareable, like the Request types and
 * People lists. The sort itself runs on the loaded rows (sortTools), not in the API. An unknown
 * `?sort=` or `?dir=` parses to the default, most used first, instead of breaking the page.
 */
import { SORT_DIRECTION_VALUES, type SortDirection } from '@nexus/shared';
import { parseAsStringLiteral, useQueryStates } from 'nuqs';
import { useCallback } from 'react';

import { DEFAULT_TOOL_SORT, TOOL_SORT_VALUES, type ToolSort } from './toolSort';

/** WHY: the nuqs parsers of the Features sort (whitelisted values, defaults on anything else). */
export const toolListSortParsers = {
  sort: parseAsStringLiteral(TOOL_SORT_VALUES).withDefault(DEFAULT_TOOL_SORT),
  dir: parseAsStringLiteral(SORT_DIRECTION_VALUES).withDefault('desc'),
};

/** WHY: what the Features view needs from the URL to sort and to write a header click back. */
export interface ToolListSort {
  sort: ToolSort;
  dir: SortDirection;
  setSort: (next: { sort: ToolSort; dir: SortDirection }) => void;
}

/** WHY: the Features table's sort, read from and written to `?sort=&dir=`. */
export function useToolListSort(): ToolListSort {
  const [raw, setRaw] = useQueryStates(toolListSortParsers);
  const setSort = useCallback(
    (next: { sort: ToolSort; dir: SortDirection }) => void setRaw(next),
    [setRaw],
  );
  return { sort: raw.sort, dir: raw.dir, setSort };
}
