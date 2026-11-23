'use client';

/**
 * The person filter of the access log as URL state (`?userKey=`).
 *
 * WHY THE URL: "Only this person" must survive a reload and a shared link. The value is the
 * OPAQUE key, checked with the API's own rule (toUserKeyFilter), so a hand-edited URL falls back
 * to "everyone" instead of producing a 400.
 */
import { parseAsString, useQueryStates } from 'nuqs';
import { useCallback } from 'react';

import { toUserKeyFilter } from '@/features/journeys/useSessionListParams';

export const accessLogParsers = {
  userKey: parseAsString,
};

export interface AccessLogParams {
  userKey: string | undefined;
  showPerson: (userKey: string) => void;
  showEveryone: () => void;
}

export function useAccessLogParams(): AccessLogParams {
  const [raw, setRaw] = useQueryStates(accessLogParsers);
  const showPerson = useCallback((userKey: string) => void setRaw({ userKey }), [setRaw]);
  const showEveryone = useCallback(() => void setRaw({ userKey: null }), [setRaw]);
  return { userKey: toUserKeyFilter(raw.userKey), showPerson, showEveryone };
}
