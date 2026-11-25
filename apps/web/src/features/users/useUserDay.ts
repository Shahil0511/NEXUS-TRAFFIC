'use client';

import type { UserDayQuery } from '@nexus/shared';
import { useQuery } from '@tanstack/react-query';

import { useMe } from '@/features/me/useMe';
import { api } from '@/lib/api';
import { qk } from '@/lib/query/keys';

/**
 * WHY: ONE IST day of one person — blocks, per app, pages, features, visits — the one-day view of
 * the "Daily activity" tab. Sent ONLY once the viewer is known to be an admin: the read is
 * admin-only and every answer is recorded in the person access log (`person_day`), so nothing is
 * requested while the viewer is unknown or not an admin. `openable` = false (a day outside the
 * range the API answers, e.g. an edited link) sends nothing either: the view says so instead.
 * Chain: api.users.day → ROUTES.users.day → UserController.day → UserService.day →
 * WebEventQueryRepository.listUserDayBlocks / listUserDayPages / listUserDayTools.
 */
export function useUserDay(userKey: string, query: UserDayQuery, openable: boolean) {
  const me = useMe();
  return useQuery({
    queryKey: qk.users.day(userKey, query),
    queryFn: ({ signal }) => api.users.day(userKey, query, { signal }),
    enabled: openable && me.data?.isAdmin === true,
  });
}
