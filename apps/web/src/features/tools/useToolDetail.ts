'use client';

import type { ToolDetailQuery } from '@nexus/shared';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/query/keys';

/**
 * WHY: one tool of one app — usage and trend, who uses it, on which pages, with which actions —
 * addressed by the OPAQUE toolId (the tool name never appears in a URL).
 * Chain: api.tools.detail → ROUTES.tools.detail → ToolController.detail → ToolService.detail →
 * WebEventQueryRepository.getToolDetail.
 */
export function useToolDetail(app: string, toolId: string, query: ToolDetailQuery) {
  return useQuery({
    queryKey: qk.tools.detail(app, toolId, query),
    queryFn: ({ signal }) => api.tools.detail(app, toolId, query, { signal }),
  });
}
