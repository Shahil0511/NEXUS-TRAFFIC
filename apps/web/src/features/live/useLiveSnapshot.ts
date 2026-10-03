'use client';

import type { LiveSnapshotQuery } from '@nexus/shared';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/query/keys';

/**
 * WHY: the Live page's starting point from the DATABASE (last 60 minute ticks + recent events).
 * Socket ticks are then written INTO this cache entry (useLiveFeed → upsertTick), so it is never
 * refetched on its own — only after a reconnect, to backfill what the socket missed.
 * Chain: api.live.snapshot → ROUTES.live.snapshot → LiveController.snapshot →
 * LiveService.snapshot (apps/api/src/services/live.service.ts).
 */
export function useLiveSnapshot(query: LiveSnapshotQuery) {
  return useQuery({
    queryKey: qk.live.snapshot(query),
    queryFn: ({ signal }) => api.live.snapshot(query, { signal }),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
}
