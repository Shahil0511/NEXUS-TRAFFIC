'use client';

/**
 * The user filter of the sessions table as URL state (`?userKey=`).
 *
 * WHY THE URL: "View sessions" on a user's profile links here with the user's OPAQUE key, and a
 * filtered list must be shareable. The value is checked with the API's own rule (userKeySchema),
 * so a hand-edited URL falls back to "every session" instead of producing a 400.
 */
import { userKeySchema } from '@nexus/shared';
import { parseAsString, useQueryStates } from 'nuqs';
import { useCallback } from 'react';

export const sessionListParsers = {
  userKey: parseAsString,
};

/** A valid userKey, or undefined (pure; exercised through the view). */
export function toUserKeyFilter(raw: string | null): string | undefined {
  return raw !== null && userKeySchema.safeParse(raw).success ? raw : undefined;
}

export interface SessionListParams {
  userKey: string | undefined;
  clearUser: () => void;
}

export function useSessionListParams(): SessionListParams {
  const [raw, setRaw] = useQueryStates(sessionListParsers);
  const clearUser = useCallback(() => void setRaw({ userKey: null }), [setRaw]);
  return { userKey: toUserKeyFilter(raw.userKey), clearUser };
}
