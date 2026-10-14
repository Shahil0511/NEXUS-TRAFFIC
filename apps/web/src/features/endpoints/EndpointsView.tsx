'use client';

import type { EndpointSort, EndpointStatsDto, TimeWindowQuery } from '@nexus/shared';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadMoreButton } from '@/components/LoadMoreButton';
import { MethodBadge } from '@/components/MethodBadge';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { filterLinkQuery, useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { formatDateTime, formatDuration, formatInteger, formatPercent } from '@/lib/format';
import { metricInfo } from '@/lib/metricCopy';
import { PAGES, withQuery } from '@/lib/pages';
import { useDebouncedValue } from '@/lib/useDebouncedValue';

import { useEndpointListParams } from './useEndpointListParams';
import { useEndpointStats } from './useEndpointStats';

const SEARCH_DEBOUNCE_MS = 300;
/** Rows per page: one screen of a dense table. */
const PAGE_SIZE = 50;
/** An error rate above this is highlighted in the table. */
const HIGH_ERROR_RATE_PCT = 5;

/**
 * WHY: a bare "12 · 3" under an error rate meant nothing to readers. Each count now names its
 * class ("12 4xx · 3 5xx", as on the route page); the column's (i) explains client vs server.
 */
function ErrorClassSplit({ errors4xx, errors5xx }: { errors4xx: number; errors5xx: number }) {
  return (
    <span className="text-2xs whitespace-nowrap text-muted-foreground">
      {formatInteger(errors4xx)} 4xx · {formatInteger(errors5xx)} 5xx
    </span>
  );
}

/** The table columns; `sortKey` values are the API whitelist (ENDPOINT_SORT_VALUES). */
export function endpointColumns(
  filters: TimeWindowQuery,
): DataTableColumn<EndpointStatsDto, EndpointSort>[] {
  const linkQuery = filterLinkQuery(filters);
  return [
    {
      id: 'route',
      header: 'Route',
      className: 'w-full max-w-0',
      cell: (row) => (
        <Link
          href={withQuery(PAGES.endpointDetail(row.endpointId), linkQuery)}
          className="flex min-w-0 items-center gap-2.5 rounded-sm outline-none hover:text-link focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <MethodBadge method={row.method} />
          <span className="min-w-0">
            <span className="block truncate font-mono text-xs">{row.routeTemplate}</span>
            <span className="block truncate text-2xs text-muted-foreground">{row.app}</span>
          </span>
        </Link>
      ),
    },
    {
      id: 'calls',
      header: 'Calls',
      hint: metricInfo('requests'),
      sortKey: 'calls',
      align: 'right',
      cell: (row) => formatInteger(row.calls),
    },
    {
      id: 'errorRate',
      header: 'Errors',
      hint: metricInfo('errorRate'),
      sortKey: 'errorRate',
      align: 'right',
      cell: (row) => (
        <span className="flex flex-col items-end">
          <span
            className={row.errorRate >= HIGH_ERROR_RATE_PCT ? 'font-semibold text-destructive' : ''}
          >
            {formatPercent(row.errorRate)}
          </span>
          <ErrorClassSplit errors4xx={row.errors4xx} errors5xx={row.errors5xx} />
        </span>
      ),
    },
    {
      id: 'p50',
      header: 'p50',
      hint: metricInfo('p50'),
      sortKey: 'p50',
      align: 'right',
      cell: (row) => formatDuration(row.p50Ms),
    },
    {
      id: 'p95',
      header: 'p95',
      hint: metricInfo('p95'),
      sortKey: 'p95',
      align: 'right',
      cell: (row) => formatDuration(row.p95Ms),
    },
    {
      id: 'p99',
      header: 'p99',
      hint: metricInfo('p99'),
      sortKey: 'p99',
      align: 'right',
      cell: (row) => formatDuration(row.p99Ms),
    },
    {
      id: 'avg',
      header: 'Avg',
      hint: metricInfo('avgLatency'),
      sortKey: 'avg',
      align: 'right',
      cell: (row) => formatDuration(row.avgMs),
    },
    {
      id: 'lastSeen',
      header: 'Last seen',
      align: 'right',
      className: 'text-muted-foreground',
      cell: (row) => formatDateTime(row.lastSeenAt),
    },
  ];
}

/**
 * The API Routes page: every (app, method, route template) with calls, error rate and latency
 * percentiles. Sorting is server-side (header click → URL → new query), search is debounced,
 * pages load on demand.
 */
export function EndpointsView() {
  const { filters } = useGlobalFilters();
  const { sort, dir, search, setSort, setSearch } = useEndpointListParams();
  const [draft, setDraft] = useState(search);
  const settled = useDebouncedValue(draft, SEARCH_DEBOUNCE_MS);

  // Push ONLY when the typed value settles — a URL change from elsewhere (back button) must not
  // be overwritten by a stale draft.
  const searchRef = useRef(search);
  searchRef.current = search;
  useEffect(() => {
    if (settled !== searchRef.current) setSearch(settled);
  }, [settled, setSearch]);

  const query = useEndpointStats({
    ...filters,
    sort,
    dir,
    search: search === '' ? undefined : search,
    limit: PAGE_SIZE,
  });
  const rows = useMemo(() => query.data?.pages.flatMap((page) => page.items), [query.data]);
  const columns = useMemo(() => endpointColumns(filters), [filters]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="API Routes"
        description="Calls, errors and latency per route template (streams excluded from percentiles)"
        actions={
          <label className="relative block w-72">
            <span className="sr-only">Search routes</span>
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Search route templates…"
              className="pl-8"
            />
          </label>
        }
      />
      <Card className="overflow-hidden">
        {query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <>
            <DataTable
              caption="API routes"
              columns={columns}
              rows={rows}
              rowKey={(row) => row.endpointId}
              sort={{ sort, dir }}
              onSortChange={setSort}
              loading={query.isPending}
              empty={
                <EmptyState
                  title={search ? 'No route matches your search' : 'No API traffic in this window'}
                  description={
                    search
                      ? 'Search matches the route template, e.g. /api/orders.'
                      : 'Routes appear once an app sends server events. Try a longer range.'
                  }
                />
              }
            />
            {rows && rows.length > 0 ? (
              <LoadMoreButton
                shown={rows.length}
                hasMore={query.hasNextPage}
                loading={query.isFetchingNextPage}
                onLoadMore={() => void query.fetchNextPage()}
              />
            ) : null}
          </>
        )}
      </Card>
    </div>
  );
}
