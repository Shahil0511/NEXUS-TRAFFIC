'use client';

import type { PageStatsDto } from '@nexus/shared';
import { useCallback, useMemo, useRef, useState } from 'react';

import { DataTable } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { GuideLinkButton } from '@/components/GuideLinkButton';
import { HeadlineSentence } from '@/components/HeadlineSentence';
import {
  cappedListNote,
  FilterMatchCount,
  filterLoadedRows,
  LoadedRowsFilter,
  NoFilterMatch,
} from '@/components/LoadedRowsFilter';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { Skeleton } from '@/components/ui/skeleton';
import { WidenRangeButton } from '@/components/WidenRangeButton';
import { filterLinkQuery, useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { formatWindowCaption } from '@/lib/format';

import { pageColumns } from './pageColumns';
import { longestMedianPages, pagesHeadline } from './pagesHeadline';
import { pageKey, pageSortCaption, sortPages } from './pageSort';
import { PagesToolsTabs } from './PagesToolsTabs';
import { usePageListSort } from './usePageListSort';
import { usePageStats } from './usePageStats';

/** Page templates fetched (the API ranks them by views). */
const PAGE_LIMIT = 100;

/** WHY: "Sorted by views, most first" plus, on a capped list, that the sort covers what is loaded. */
function tableDescription(sortCaption: string, capped: string | null): string {
  return capped ? `${sortCaption} · ${capped}; sorting covers the loaded rows` : sortCaption;
}

/**
 * WHY: pages are loaded but none has a measured visible time — the tracker sends views without
 * visibility ticks. The sentence says so; this keeps the integration guide one click away (the
 * table's empty state, which also carries it, shows only when no page was viewed at all).
 */
function needsVisibleTimeGuide(items: readonly PageStatsDto[] | undefined): boolean {
  return items !== undefined && items.length > 0 && longestMedianPages(items).length === 0;
}

/**
 * The Pages tab of "Pages & features": how long each page is actually looked at (VISIBLE time —
 * a background tab does not count), how often it is viewed, by how many people, and where visits
 * end.
 *
 * WHY a sentence and no charts: the page's totals, the page people look at longest and the page
 * most visits end on read as one sentence in the hero (pagesHeadline); the table below holds
 * every number and sorts by any of them (usePageListSort → sortPages, on the loaded rows).
 */
export function PagesView() {
  const { filters } = useGlobalFilters();
  const pages = usePageStats({ ...filters, limit: PAGE_LIMIT });
  const items = pages.data?.items;
  const linkQuery = useMemo(() => filterLinkQuery(filters), [filters]);
  const columns = useMemo(() => pageColumns(linkQuery), [linkQuery]);
  const { sort, dir, setSort } = usePageListSort();
  const [filterText, setFilterText] = useState('');
  const filterInputRef = useRef<HTMLInputElement>(null);
  // WHY focus the search box: "Clear filter" unmounts itself, which would drop focus to <body>.
  const clearFilter = useCallback(() => {
    setFilterText('');
    filterInputRef.current?.focus();
  }, []);
  const filtering = filterText.trim() !== '';
  const rows = useMemo(
    () =>
      sortPages(
        filterLoadedRows(items, filterText, (page) => page.pathTemplate),
        sort,
        dir,
      ),
    [items, filterText, sort, dir],
  );
  const capped = cappedListNote(items?.length ?? 0, PAGE_LIMIT, 'pages');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pages & features"
        description={
          pages.data
            ? formatWindowCaption(pages.data.window)
            : 'Time on page and the features people use'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PagesToolsTabs active="pages" />
            {needsVisibleTimeGuide(items) ? <GuideLinkButton chapter="browserContract" /> : null}
          </div>
        }
        headline={
          items ? (
            <HeadlineSentence
              parts={pagesHeadline(items, linkQuery, capped !== null)}
              className="break-words"
            />
          ) : pages.isPending ? (
            <Skeleton className="h-7 w-full max-w-xl" />
          ) : null
        }
      />

      <Panel
        title="Pages"
        description={tableDescription(pageSortCaption(sort, dir), capped)}
        contentClassName="px-0 pb-0"
        aside={
          items && items.length > 0 ? (
            <LoadedRowsFilter
              value={filterText}
              onChange={setFilterText}
              inputRef={filterInputRef}
              label="Filter loaded pages by template"
              placeholder="Filter by template…"
            />
          ) : null
        }
      >
        {pages.isError ? (
          <ErrorState error={pages.error} onRetry={() => void pages.refetch()} />
        ) : (
          <>
            <FilterMatchCount
              active={filtering && items !== undefined}
              shown={rows?.length ?? 0}
              loaded={items?.length ?? 0}
              noun="pages"
            />
            <DataTable
              caption="Pages"
              columns={columns}
              rows={rows}
              rowKey={pageKey}
              sort={{ sort, dir }}
              onSortChange={setSort}
              loading={pages.isPending}
              empty={
                filtering && items && items.length > 0 ? (
                  <NoFilterMatch noun="pages" onClear={clearFilter} />
                ) : (
                  <EmptyState
                    title="No page views in this window"
                    description="Pages and their visible time appear once an app's browser tracker sends events. Try a longer range or see the integration guide."
                    action={
                      <div className="flex flex-wrap justify-center gap-2">
                        <WidenRangeButton />
                        <GuideLinkButton chapter="browserContract" />
                      </div>
                    }
                  />
                )
              }
            />
          </>
        )}
      </Panel>
    </div>
  );
}
