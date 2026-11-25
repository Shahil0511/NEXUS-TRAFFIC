'use client';

import type { UserPatternQuery } from '@nexus/shared';
import { useQuery } from '@tanstack/react-query';

import { useMe } from '@/features/me/useMe';
import { api } from '@/lib/api';
import { qk } from '@/lib/query/keys';

/**
 * WHY: the weekday × hour grid (IST) of one person's recorded activity over the last 7 or 30 days —
 * the "Usual activity hours" panel of the Daily activity tab. Sent ONLY once the viewer is known to
 * be an admin (the read is admin-only and recorded in the person access log, `person_pattern`) AND
 * `ready` is true: the panel passes the daily read's success, so opening the page never adds this
 * statement to the profile and daily reads already running.
 * Chain: api.users.pattern → ROUTES.users.pattern → UserController.pattern → UserService.pattern →
 * WebEventQueryRepository.listUserActivityPattern.
 */
export function useUserPattern(userKey: string, query: UserPatternQuery, ready: boolean) {
  const me = useMe();
  return useQuery({
    queryKey: qk.users.pattern(userKey, query),
    queryFn: ({ signal }) => api.users.pattern(userKey, query, { signal }),
    enabled: ready && me.data?.isAdmin === true,
  });
}
