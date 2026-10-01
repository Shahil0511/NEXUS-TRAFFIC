'use client';

import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/query/keys';

/**
 * WHY: the registered apps, for the global App filter (S5 adds the admin Apps page on top).
 * Chain: api.apps.list → ROUTES.apps.list → AppController.list → AppQueryService.list.
 */
export function useAppList() {
  return useQuery({
    queryKey: qk.apps.list(),
    queryFn: ({ signal }) => api.apps.list({ signal }),
  });
}
