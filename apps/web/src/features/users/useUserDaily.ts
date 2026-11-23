'use client';

import type { UserDailyQuery } from '@nexus/shared';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/query/keys';

/**
 * WHY: one row per IST day the person was active in the window (first / last activity,
 * tab-visible time, counts), newest first — the "Daily activity" tab.
 * Chain: api.users.daily → ROUTES.users.daily → UserController.daily → UserService.daily →
 * WebEventQueryRepository.listUserDailyActivity.
 */
export function useUserDaily(userKey: string, query: UserDailyQuery) {
  return useQuery({
    queryKey: qk.users.daily(userKey, query),
    queryFn: ({ signal }) => api.users.daily(userKey, query, { signal }),
  });
}
