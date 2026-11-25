'use client';

/**
 * Sort of the Users table as URL state (`?sort=&dir=`). The email SEARCH is deliberately not here:
 * it never goes in a URL (ADR 0006).
 *
 * WHY THE URL: a sorted table must survive a reload and be shareable. The values are the API's
 * whitelist (USER_SORT_VALUES: last or first activity only), so the URL can never carry a key the API
 * would reject. A link from before the count sorts were retired (`?sort=requests`) parses to the
 * default, last activity first, instead of breaking the page. @see ADR 0017
 */
import {
  DEFAULT_USER_SORT,
  SORT_DIRECTION_VALUES,
  USER_SORT_VALUES,
  type SortDirection,
  type UserSort,
} from '@nexus/shared';
import { parseAsStringLiteral, useQueryStates } from 'nuqs';
import { useCallback } from 'react';

export const userListParsers = {
  sort: parseAsStringLiteral(USER_SORT_VALUES).withDefault(DEFAULT_USER_SORT),
  dir: parseAsStringLiteral(SORT_DIRECTION_VALUES).withDefault('desc'),
};

export interface UserListParams {
  sort: UserSort;
  dir: SortDirection;
  setSort: (next: { sort: UserSort; dir: SortDirection }) => void;
}

export function useUserListParams(): UserListParams {
  const [raw, setRaw] = useQueryStates(userListParsers);
  const setSort = useCallback(
    (next: { sort: UserSort; dir: SortDirection }) => void setRaw(next),
    [setRaw],
  );
  return { sort: raw.sort, dir: raw.dir, setSort };
}
