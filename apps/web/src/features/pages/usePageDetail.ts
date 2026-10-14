'use client';

import type { PageDetailQuery } from '@nexus/shared';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/query/keys';

/**
 * WHY: one page of one app — stats, trend, who views it, tools used on it, API calls it makes and
 * the pages around it — addressed by the OPAQUE pageId (the template never appears in a URL).
 * Chain: api.pages.detail → ROUTES.pages.detail → PageController.detail → PageService.detail →
 * WebEventQueryRepository.getPageDetail + ApiRequestQueryRepository.listPageApiCalls.
 */
export function usePageDetail(app: string, pageId: string, query: PageDetailQuery) {
  return useQuery({
    queryKey: qk.pages.detail(app, pageId, query),
    queryFn: ({ signal }) => api.pages.detail(app, pageId, query, { signal }),
  });
}
