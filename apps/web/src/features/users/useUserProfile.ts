'use client';

import type { UserProfileQuery } from '@nexus/shared';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/query/keys';

/**
 * WHY: one user's totals, top pages/tools and countries, by the OPAQUE userKey (HMAC of the
 * email — the email itself never appears in a URL). 404 when the user has no activity in the window.
 * Chain: api.users.profile → ROUTES.users.profile → UserController.profile →
 * UserService.profile → WebEventQueryRepository.getUserProfile.
 */
export function useUserProfile(userKey: string, query: UserProfileQuery) {
  return useQuery({
    queryKey: qk.users.profile(userKey, query),
    queryFn: ({ signal }) => api.users.profile(userKey, query, { signal }),
  });
}
