'use client';

import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/query/keys';

/** Hours, not minutes: who you are does not change during a session. */
const ME_STALE_TIME_MS = 60 * 60 * 1000;

/**
 * WHY: the signed-in viewer (email + admin flag) for the top bar and admin-only UI.
 * Chain: api.me.get → ROUTES.me.get → MeController.get (apps/api/src/http/controllers/me.controller.ts).
 */
export function useMe() {
  return useQuery({
    queryKey: qk.me.get(),
    queryFn: ({ signal }) => api.me.get({ signal }),
    staleTime: ME_STALE_TIME_MS,
  });
}
