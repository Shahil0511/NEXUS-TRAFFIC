'use client';

import type { SessionQuery } from '@nexus/shared';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/query/keys';

/**
 * WHY: one session's replay — its browser events in order with the session's API calls
 * interleaved by time. The window only bounds the scan (partition pruning); 404 when the session
 * has no events in it.
 * Chain: api.journeys.session → ROUTES.journeys.session → JourneyController.session →
 * JourneyService.session → WebEventQueryRepository.getSession.
 */
export function useSessionDetail(app: string, sessionId: string, query: SessionQuery) {
  return useQuery({
    queryKey: qk.journeys.session(app, sessionId, query),
    queryFn: ({ signal }) => api.journeys.session(app, sessionId, query, { signal }),
  });
}
