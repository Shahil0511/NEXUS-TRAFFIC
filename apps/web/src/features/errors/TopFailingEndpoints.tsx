'use client';

import type { EndpointStatsDto, TimeWindowQuery } from '@nexus/shared';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { EmptyState } from '@/components/EmptyState';
import { MethodBadge } from '@/components/MethodBadge';
import { filterLinkQuery } from '@/features/filters/useGlobalFilters';
import { formatInteger, formatPercent } from '@/lib/format';
import { PAGES, withQuery } from '@/lib/pages';

export interface TopFailingEndpointsProps {
  endpoints: readonly EndpointStatsDto[];
  filters: TimeWindowQuery;
  /** How many rows to show (the API may send more). */
  limit?: number;
}

const DEFAULT_LIMIT = 6;

/**
 * WHY: "where does it break?" at a glance — routes ranked by failures, each opening its detail
 * page. The link target is built ONLY from the opaque endpointId (PAGES); the route template is
 * ingested data and is rendered as text.
 */
export function TopFailingEndpoints({
  endpoints,
  filters,
  limit = DEFAULT_LIMIT,
}: TopFailingEndpointsProps) {
  if (endpoints.length === 0) {
    return (
      <EmptyState
        title="No failing routes"
        description="Nothing returned 4xx or 5xx in this window."
      />
    );
  }
  const linkQuery = filterLinkQuery(filters);
  return (
    <ol className="-mx-2 space-y-0.5" aria-label="Top failing routes">
      {endpoints.slice(0, limit).map((endpoint) => (
        <li key={endpoint.endpointId}>
          <Link
            href={withQuery(PAGES.endpointDetail(endpoint.endpointId), linkQuery)}
            className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <MethodBadge method={endpoint.method} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-xs">{endpoint.routeTemplate}</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {endpoint.app}
              </span>
            </span>
            <span className="text-right text-xs tabular">
              <span className="block font-semibold">
                {formatInteger(endpoint.errors4xx + endpoint.errors5xx)}
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {formatPercent(endpoint.errorRate)}
              </span>
            </span>
            <ChevronRight
              className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              aria-hidden="true"
            />
          </Link>
        </li>
      ))}
    </ol>
  );
}
