'use client';

import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/query/keys';

/** A minute is fresh enough: the page answers "is my app sending?", not a live tick. */
const HEALTH_REFETCH_MS = 60_000;

/**
 * WHY: per-app ingest health for the Integration page (status, counters, SDKs, warnings).
 * Chain: api.integration.health → ROUTES.integration.health → IntegrationController.health →
 * IntegrationService.health → IngestHealthRepository.perApp.
 */
export function useIntegrationHealth() {
  return useQuery({
    queryKey: qk.integration.health(),
    queryFn: ({ signal }) => api.integration.health({ signal }),
    refetchInterval: HEALTH_REFETCH_MS,
  });
}
