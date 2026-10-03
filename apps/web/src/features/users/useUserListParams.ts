'use client';

/**
 * Search of the Users table as URL state (`?q=`).
 *
 * WHY THE URL: like the global filters, a filtered table must survive a reload and be shareable.
 */
import { parseAsString, useQueryStates } from 'nuqs';
import { useCallback } from 'react';

export const userListParsers = {
  q: parseAsString.withDefault(''),
};

export interface UserListParams {
  search: string;
  setSearch: (search: string) => void;
}

export function useUserListParams(): UserListParams {
  const [raw, setRaw] = useQueryStates(userListParsers);
  const setSearch = useCallback(
    (search: string) => void setRaw({ q: search.trim() === '' ? null : search }),
    [setRaw],
  );
  return { search: raw.q, setSearch };
}
