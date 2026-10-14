'use client';

import type { PageStatsDto } from '@nexus/shared';
import { useMemo } from 'react';

import { AppChip } from '@/components/AppChip';
import { RankedBarChart, type RankedBar } from '@/components/charts/RankedBarChart';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
import { ChartSkeleton, ListSkeleton, Panel } from '@/components/Panel';
import { QueryState } from '@/components/QueryState';
import { RankedList } from '@/components/RankedList';
import { filterLinkQuery, useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { formatDuration, formatInteger, formatPercent, formatWindowCaption } from '@/lib/format';

import { PagesToolsTabs } from './PagesToolsTabs';
import { usePageStats } from './usePageStats';

/** Page templates fetched (the API ranks them by views). */
const PAGE_LIMIT = 100;
const CHART_BARS = 8;
const EXIT_ROWS = 5;
const PERCENT = 100;

function pageKey(page: PageStatsDto): string {
  return `${page.app}|${page.pathTemplate}`;
}

/** The pages with the longest median visible time (pages without a measurement are skipped). */
export function longestMedianPages(
  pages: readonly PageStatsDto[],
  limit = CHART_BARS,
): RankedBar[] {
  return pages
    .filter((page) => page.p50VisibleMs !== null)
    .sort((a, b) => (b.p50VisibleMs ?? 0) - (a.p50VisibleMs ?? 0))
    .slice(0, limit)
    .map((page) => ({ key: pageKey(page), label: page.pathTemplate, value: page.p50VisibleMs! }));
}

function topExitPages(pages: readonly PageStatsDto[]): PageStatsDto[] {
  return pages
    .filter((page) => page.exits > 0)
    .sort((a, b) => b.exits - a.exits)
    .slice(0, EXIT_ROWS);
}

/** The table columns; the app chip opens the app's page (links carry `linkQuery`). */
function pageColumns(
  linkQuery: Readonly<Record<string, string | undefined>>,
): DataTableColumn<PageStatsDto>[] {
  return [
    {
      id: 'page',
      header: 'Page',
      className: 'w-full max-w-0',
      cell: (row) => (
        <span className="block min-w-0 space-y-1">
          <span className="block truncate font-mono text-xs" title={row.pathTemplate}>
            {row.pathTemplate}
          </span>
          <AppChip app={row.app} linkQuery={linkQuery} />
        </span>
      ),
    },
    { id: 'views', header: 'Views', align: 'right', cell: (row) => formatInteger(row.views) },
    {
      id: 'sessions',
      header: 'Sessions',
      align: 'right',
      cell: (row) => formatInteger(row.uniqueSessions),
    },
    {
      id: 'avg',
      header: 'Avg visible',
      align: 'right',
      cell: (row) => formatDuration(row.avgVisibleMs),
    },
    {
      id: 'p50',
      header: 'p50 visible',
      align: 'right',
      cell: (row) => formatDuration(row.p50VisibleMs),
    },
    {
      id: 'exits',
      header: 'Exits',
      align: 'right',
      cell: (row) => (
        <span className="flex flex-col items-end">
          <span>{formatInteger(row.exits)}</span>
          <span className="text-[11px] text-muted-foreground">
            {formatPercent(
              row.uniqueSessions > 0 ? (row.exits / row.uniqueSessions) * PERCENT : null,
            )}
            <span className="sr-only"> of sessions</span>
          </span>
        </span>
      ),
    },
  ];
}

/**
 * The Pages tab of "Pages & Tools": how long each page is actually looked at (VISIBLE time —
 * a background tab does not count), how often it is viewed, and where sessions end.
 */
export function PagesView() {
  const { filters } = useGlobalFilters();
  const pages = usePageStats({ ...filters, limit: PAGE_LIMIT });
  const items = pages.data?.items;
  const columns = useMemo(() => pageColumns(filterLinkQuery(filters)), [filters]);
  const longest = useMemo(() => longestMedianPages(items ?? []), [items]);
  const exits = useMemo(() => topExitPages(items ?? []), [items]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pages & Tools"
        description={
          pages.data
            ? formatWindowCaption(pages.data.window)
            : 'Time on page and the UI tools people use'
        }
        actions={<PagesToolsTabs active="pages" />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title="Time on page"
          description={`Median visible time per view · top ${CHART_BARS}`}
          className="lg:col-span-2"
        >
          <QueryState
            query={pages}
            skeleton={<ChartSkeleton />}
            isEmpty={longest.length === 0}
            empty={
              <EmptyState
                title="No time measured"
                description="Visible time arrives with page_time events from the browser SDK."
              />
            }
          >
            {() => (
              <RankedBarChart
                bars={longest}
                seriesLabel="Median visible time"
                ariaLabel="Median visible time per page"
                format={formatDuration}
                tickFormat={formatDuration}
                labelWidth={180}
              />
            )}
          </QueryState>
        </Panel>
        <Panel title="Exit pages" description="Where sessions end">
          <QueryState
            query={pages}
            skeleton={<ListSkeleton rows={EXIT_ROWS} />}
            isEmpty={exits.length === 0}
            empty={<EmptyState title="No exits recorded" />}
          >
            {() => (
              <RankedList
                ariaLabel="Exit pages"
                items={exits.map((page) => ({
                  key: pageKey(page),
                  label: <span className="font-mono">{page.pathTemplate}</span>,
                  sublabel: page.app,
                  value: page.exits,
                }))}
              />
            )}
          </QueryState>
        </Panel>
      </div>

      <Panel title="Pages" description="Most viewed first" contentClassName="px-0 pb-0">
        {pages.isError ? (
          <ErrorState error={pages.error} onRetry={() => void pages.refetch()} />
        ) : (
          <DataTable
            caption="Pages"
            columns={columns}
            rows={items}
            rowKey={pageKey}
            loading={pages.isPending}
            empty={
              <EmptyState
                title="No page views in this window"
                description="Pages appear once an app sends browser events. Try a longer range."
              />
            }
          />
        )}
      </Panel>
    </div>
  );
}
