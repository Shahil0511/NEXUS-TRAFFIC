'use client';

import type { Grain, ToolUsageDto } from '@nexus/shared';
import { useMemo } from 'react';

import { AppChip } from '@/components/AppChip';
import { RankedBarChart, type RankedBar } from '@/components/charts/RankedBarChart';
import { Sparkline } from '@/components/charts/Sparkline';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
import { ChartSkeleton, ListSkeleton, Panel } from '@/components/Panel';
import { QueryState } from '@/components/QueryState';
import { RankedList } from '@/components/RankedList';
import { filterLinkQuery, useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { PagesToolsTabs } from '@/features/pages/PagesToolsTabs';
import { formatDateTime, formatInteger, formatWindowCaption, GRAIN_LABELS } from '@/lib/format';

import { useToolUsage } from './useToolUsage';

/** Tools fetched (the API ranks them by uses). */
const TOOL_LIMIT = 100;
const CHART_BARS = 8;
const REACH_ROWS = 5;

function toolKey(tool: ToolUsageDto): string {
  return `${tool.app}|${tool.tool}`;
}

/** Bars of the "most used" chart: the API already ranks by uses. */
function mostUsedBars(tools: readonly ToolUsageDto[]): RankedBar[] {
  return tools
    .slice(0, CHART_BARS)
    .map((tool) => ({ key: toolKey(tool), label: tool.tool, value: tool.uses }));
}

function widestReach(tools: readonly ToolUsageDto[]): ToolUsageDto[] {
  return tools
    .filter((tool) => tool.distinctUsers > 0)
    .sort((a, b) => b.distinctUsers - a.distinctUsers)
    .slice(0, REACH_ROWS);
}

/** "Uses per hourly bucket, 0 to 40" — what the sparkline shows, for screen readers. */
function trendLabel(tool: ToolUsageDto, grain: Grain): string {
  const values = tool.trend.map((point) => point.uses);
  if (values.length === 0) return `No trend for ${tool.tool}`;
  return `${tool.tool}: uses per ${GRAIN_LABELS[grain]} bucket, ${formatInteger(
    Math.min(...values),
  )} to ${formatInteger(Math.max(...values))}`;
}

export function toolColumns(
  grain: Grain,
  linkQuery: Readonly<Record<string, string | undefined>> = {},
): DataTableColumn<ToolUsageDto>[] {
  return [
    {
      id: 'tool',
      header: 'Tool',
      className: 'w-full max-w-0',
      cell: (row) => (
        <span className="block min-w-0 space-y-1">
          <span className="block truncate font-medium" title={row.tool}>
            {row.tool}
          </span>
          <AppChip app={row.app} linkQuery={linkQuery} />
        </span>
      ),
    },
    { id: 'uses', header: 'Uses', align: 'right', cell: (row) => formatInteger(row.uses) },
    {
      id: 'users',
      header: 'Users',
      align: 'right',
      cell: (row) => formatInteger(row.distinctUsers),
    },
    {
      id: 'sessions',
      header: 'Sessions',
      align: 'right',
      cell: (row) => formatInteger(row.distinctSessions),
    },
    {
      id: 'trend',
      header: 'Trend',
      cell: (row) => (
        <Sparkline
          values={row.trend.map((point) => point.uses)}
          ariaLabel={trendLabel(row, grain)}
        />
      ),
    },
    {
      id: 'lastUsed',
      header: 'Last used',
      align: 'right',
      className: 'text-muted-foreground',
      cell: (row) => <time dateTime={row.lastUsedAt}>{formatDateTime(row.lastUsedAt)}</time>,
    },
  ];
}

/**
 * The Tools tab of "Pages & Tools": which UI tools/features are used, by how many verified users
 * and sessions, and how usage moved over the window (auto-captured `data-nexus-tool` clicks plus
 * manual trackTool() calls).
 */
export function ToolsView() {
  const { filters } = useGlobalFilters();
  const tools = useToolUsage({ ...filters, limit: TOOL_LIMIT });
  const items = tools.data?.items;
  const grain = tools.data?.window.grain ?? 'hour';
  const bars = useMemo(() => mostUsedBars(items ?? []), [items]);
  const reach = useMemo(() => widestReach(items ?? []), [items]);
  const linkQuery = useMemo(() => filterLinkQuery(filters), [filters]);
  const columns = useMemo(() => toolColumns(grain, linkQuery), [grain, linkQuery]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pages & Tools"
        description={
          tools.data
            ? formatWindowCaption(tools.data.window)
            : 'Time on page and the UI tools people use'
        }
        actions={<PagesToolsTabs active="tools" />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title="Most used tools"
          description={`Uses in this window · top ${CHART_BARS}`}
          className="lg:col-span-2"
        >
          <QueryState
            query={tools}
            skeleton={<ChartSkeleton />}
            isEmpty={bars.length === 0}
            empty={
              <EmptyState
                title="No tool usage"
                description="Tools appear from data-nexus-tool clicks and trackTool() calls."
              />
            }
          >
            {() => (
              <RankedBarChart
                bars={bars}
                seriesLabel="Uses"
                ariaLabel="Uses per tool"
                format={formatInteger}
              />
            )}
          </QueryState>
        </Panel>
        <Panel title="Widest reach" description="Distinct verified users">
          <QueryState
            query={tools}
            skeleton={<ListSkeleton rows={REACH_ROWS} />}
            isEmpty={reach.length === 0}
            empty={
              <EmptyState
                title="No verified users"
                description="Only SSO or app-attested identities are counted."
              />
            }
          >
            {() => (
              <RankedList
                ariaLabel="Tools by distinct users"
                items={reach.map((tool) => ({
                  key: toolKey(tool),
                  label: tool.tool,
                  sublabel: tool.app,
                  value: tool.distinctUsers,
                }))}
              />
            )}
          </QueryState>
        </Panel>
      </div>

      <Panel title="Tools" description="Most used first" contentClassName="px-0 pb-0">
        {tools.isError ? (
          <ErrorState error={tools.error} onRetry={() => void tools.refetch()} />
        ) : (
          <DataTable
            caption="Tools"
            columns={columns}
            rows={items}
            rowKey={toolKey}
            loading={tools.isPending}
            empty={
              <EmptyState
                title="No tool usage in this window"
                description="Tools appear once an app tracks them. Try a longer range."
              />
            }
          />
        )}
      </Panel>
    </div>
  );
}
