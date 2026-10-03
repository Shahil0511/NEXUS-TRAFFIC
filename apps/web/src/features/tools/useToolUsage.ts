'use client';

import type { ToolUsageQuery } from '@nexus/shared';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/query/keys';

/**
 * WHY: which UI tools/features are used — uses, distinct verified users, sessions and a
 * gap-filled trend per window bucket, most used first.
 * Chain: api.tools.usage → ROUTES.tools.usage → ToolController.usage → ToolService.usage →
 * WebEventQueryRepository.listToolUsage.
 */
export function useToolUsage(query: ToolUsageQuery) {
  return useQuery({
    queryKey: qk.tools.usage(query),
    queryFn: ({ signal }) => api.tools.usage(query, { signal }),
  });
}
