import type { UserDayToolDto } from '@nexus/shared';

import { AppChip } from '@/components/AppChip';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { ToolLink } from '@/components/EntityLinks';
import { formatClockTime, formatInteger } from '@/lib/format';
import { METRIC_COPY, metricInfo } from '@/lib/metricCopy';

import { DAY_HALF_TABLE_MIN_WIDTH_CLASS } from './UserDayPagesTable';

type LinkQuery = Readonly<Record<string, string | undefined>>;

/** Fixed widths of the 'fit' table; Feature has none and takes the rest (16rem fixed). */
const COLUMN_WIDTH = {
  app: 'w-24',
  clock: 'w-20',
  count: 'w-20',
} as const;

function toolColumns(linkQuery: LinkQuery): readonly DataTableColumn<UserDayToolDto>[] {
  return [
    {
      id: 'app',
      header: 'App',
      className: COLUMN_WIDTH.app,
      cell: (row) => <AppChip app={row.app} linkQuery={linkQuery} className="min-w-0" />,
    },
    {
      id: 'feature',
      header: 'Feature',
      cell: (row) => (
        <ToolLink
          app={row.app}
          toolId={row.toolId}
          tool={row.tool}
          linkQuery={linkQuery}
          className="break-all"
        />
      ),
    },
    {
      id: 'firstUse',
      header: 'First use (IST)',
      className: COLUMN_WIDTH.clock,
      cell: (row) => <span className="tabular">{formatClockTime(row.firstUseAt)}</span>,
    },
    {
      id: 'uses',
      header: 'Uses',
      hint: metricInfo('featureUses'),
      align: 'right',
      className: COLUMN_WIDTH.count,
      cell: (row) => formatInteger(row.uses),
    },
  ];
}

/**
 * WHY: the features used on the day in the order they were first used (IST) — no bars, no "top":
 * the order of use, not a ranking.
 */
export function UserDayToolsTable({
  tools,
  linkQuery,
}: {
  tools: readonly UserDayToolDto[];
  linkQuery: LinkQuery;
}) {
  return (
    <DataTable
      caption={METRIC_COPY.featureUses.label}
      layout="fit"
      tableClassName={tools.length > 0 ? DAY_HALF_TABLE_MIN_WIDTH_CLASS : undefined}
      columns={toolColumns(linkQuery)}
      rows={tools}
      rowKey={(row) => `${row.app}|${row.toolId}`}
      empty={
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          No features used on this day.
        </p>
      }
    />
  );
}
