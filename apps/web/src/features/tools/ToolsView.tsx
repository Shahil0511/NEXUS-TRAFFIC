'use client';

import type { Grain, ToolUsageDto } from '@nexus/shared';
import { useCallback, useMemo, useRef, useState } from 'react';

import { AppChip } from '@/components/AppChip';
import { Sparkline } from '@/components/charts/Sparkline';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { ToolLink } from '@/components/EntityLinks';
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
import { PagesToolsTabs } from '@/features/pages/PagesToolsTabs';
import { formatDateTime, formatInteger, formatWindowCaption, GRAIN_LABELS } from '@/lib/format';
import { metricInfo } from '@/lib/metricCopy';

import { toolKey, toolSortCaption, sortTools, type ToolSort } from './toolSort';
import { toolsHeadline } from './toolsHeadline';
import { useToolListSort } from './useToolListSort';
import { useToolUsage } from './useToolUsage';

/** Features fetched (the API ranks them by uses). */
const TOOL_LIMIT = 100;

/** "Uses per hourly bucket, 0 to 40" — what the sparkline shows, for screen readers. */
function trendLabel(tool: ToolUsageDto, grain: Grain): string {
  const values = tool.trend.map((point) => point.uses);
  if (values.length === 0) return `No trend for ${tool.tool}`;
  return `${tool.tool}: uses per ${GRAIN_LABELS[grain]} bucket, ${formatInteger(
    Math.min(...values),
  )} to ${formatInteger(Math.max(...values))}`;
}

/**
 * WHY: the columns of every list of features (the Features list; exported so the App profile
 * can reuse them, B8-7).
 * The first column is the feature's signature: its name (opens the feature) over its app chip and
 * its trend over the window (a sparkline described for screen readers by trendLabel). Every number
 * column carries a `sortKey` (TOOL_SORT_VALUES); a table without `onSortChange` shows plain
 * headers. Links carry `linkQuery` (the page's filters).
 */
export function toolColumns(
  grain: Grain,
  linkQuery: Readonly<Record<string, string | undefined>> = {},
): DataTableColumn<ToolUsageDto, ToolSort>[] {
  return [
    {
      id: 'tool',
      header: 'Feature',
      className: 'w-full min-w-48 max-w-0',
      cell: (row) => (
        <span className="block min-w-0 space-y-1">
          <ToolLink
            app={row.app}
            toolId={row.toolId}
            tool={row.tool}
            linkQuery={linkQuery}
            className="block truncate font-medium"
          />
          <AppChip app={row.app} linkQuery={linkQuery} />
          <span className="block">
            <Sparkline
              values={row.trend.map((point) => point.uses)}
              ariaLabel={trendLabel(row, grain)}
            />
          </span>
        </span>
      ),
    },
    {
      id: 'uses',
      header: 'Uses',
      sortKey: 'uses',
      align: 'right',
      cell: (row) => formatInteger(row.uses),
    },
    {
      id: 'people',
      header: 'People',
      sortKey: 'people',
      hint: metricInfo('uniqueUsers'),
      align: 'right',
      cell: (row) => formatInteger(row.distinctUsers),
    },
    {
      id: 'sessions',
      header: 'Visits',
      sortKey: 'sessions',
      align: 'right',
      cell: (row) => formatInteger(row.distinctSessions),
    },
    {
      id: 'lastUsed',
      header: 'Last used',
      sortKey: 'lastUsed',
      align: 'right',
      className: 'text-muted-foreground',
      cell: (row) => <time dateTime={row.lastUsedAt}>{formatDateTime(row.lastUsedAt)}</time>,
    },
  ];
}

/** WHY: "Sorted by uses, most first" plus, on a capped list, that the sort covers what is loaded. */
function tableDescription(sortCaption: string, capped: string | null): string {
  return capped ? `${sortCaption} · ${capped}; sorting covers the loaded rows` : sortCaption;
}

/**
 * The Features tab of "Pages & features": which UI features are used, by how many verified people
 * and visits, and how usage moved over the window (auto-captured `data-nexus-tool` clicks plus
 * manual trackTool() calls; on screen a tool is a "feature").
 *
 * WHY a sentence and no charts: the totals, the most used feature and the one used by the most
 * people read as one sentence in the hero (toolsHeadline); the table below holds every number,
 * each feature's trend under its name, and sorts by any column (useToolListSort → sortTools, on
 * the loaded rows).
 */
export function ToolsView() {
  const { filters } = useGlobalFilters();
  const tools = useToolUsage({ ...filters, limit: TOOL_LIMIT });
  const items = tools.data?.items;
  const grain = tools.data?.window.grain ?? 'hour';
  const linkQuery = useMemo(() => filterLinkQuery(filters), [filters]);
  const columns = useMemo(() => toolColumns(grain, linkQuery), [grain, linkQuery]);
  const { sort, dir, setSort } = useToolListSort();
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
      sortTools(
        filterLoadedRows(items, filterText, (tool) => tool.tool),
        sort,
        dir,
      ),
    [items, filterText, sort, dir],
  );
  const capped = cappedListNote(items?.length ?? 0, TOOL_LIMIT, 'features');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pages & features"
        description={
          tools.data
            ? formatWindowCaption(tools.data.window)
            : 'Time on page and the features people use'
        }
        actions={<PagesToolsTabs active="tools" />}
        headline={
          items ? (
            <HeadlineSentence
              parts={toolsHeadline(items, linkQuery, capped !== null)}
              className="break-words"
            />
          ) : tools.isPending ? (
            <Skeleton className="h-7 w-full max-w-xl" />
          ) : null
        }
      />

      <Panel
        title="Features"
        description={tableDescription(toolSortCaption(sort, dir), capped)}
        contentClassName="px-0 pb-0"
        aside={
          items && items.length > 0 ? (
            <LoadedRowsFilter
              value={filterText}
              onChange={setFilterText}
              inputRef={filterInputRef}
              label="Filter loaded features by name"
              placeholder="Filter by feature name…"
            />
          ) : null
        }
      >
        {tools.isError ? (
          <ErrorState error={tools.error} onRetry={() => void tools.refetch()} />
        ) : (
          <>
            <FilterMatchCount
              active={filtering && items !== undefined}
              shown={rows?.length ?? 0}
              loaded={items?.length ?? 0}
              noun="features"
            />
            <DataTable
              caption="Features"
              columns={columns}
              rows={rows}
              rowKey={toolKey}
              sort={{ sort, dir }}
              onSortChange={setSort}
              loading={tools.isPending}
              empty={
                filtering && items && items.length > 0 ? (
                  <NoFilterMatch noun="features" onClear={clearFilter} />
                ) : (
                  <EmptyState
                    title="No feature usage in this window"
                    description="Features appear once the app's team tags its buttons. Try a longer range or see the integration guide."
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
