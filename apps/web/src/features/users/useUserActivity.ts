'use client';

import type { UserActivityQuery } from '@nexus/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/query/keys';

/**
 * WHY: daily active (verified) users over the window, plus weekly / monthly active users.
 * Chain: api.users.activity → ROUTES.users.activity → UserController.activity →
 * UserService.activity → WebEventQueryRepository.listDailyUsers + countIdentifiedUsers.
 */
export function useUserActivity(query: UserActivityQuery) {
  return useQuery({
    queryKey: qk.users.activity(query),
    queryFn: ({ signal }) => api.users.activity(query, { signal }),
    // A filter change keeps the current rows on screen until the new ones arrive (no flicker).
    placeholderData: keepPreviousData,
  });
}
