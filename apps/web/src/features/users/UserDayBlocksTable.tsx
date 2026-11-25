import type { UserActivityBlockDto } from '@nexus/shared';

import { AppChip } from '@/components/AppChip';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { formatClockTime, formatHoursMinutes, formatInteger } from '@/lib/format';
import { METRIC_COPY, metricInfo } from '@/lib/metricCopy';

type LinkQuery = Readonly<Record<string, string | undefined>>;

/** Fixed widths of the 'fit' table; Apps has none and takes the rest (43rem fixed). */
const COLUMN_WIDTH = {
  clock: 'w-20',
  length: 'w-24',
  time: 'w-24',
  count: 'w-20',
} as const;

/** 43rem of fixed columns + at least 10rem for Apps; below it the table scrolls in place. */
export const DAY_BLOCKS_TABLE_MIN_WIDTH_CLASS = 'min-w-[53rem]';

/**
 * The activity blocks of the day, in start order, one fact per column. WHY these columns: a block
 * says when a stretch of use began and ended, how long a page was on screen in it (once per
 * moment, and per tab), which apps and how many pages, features and calls. Lengths are per row and
 * never added up; nothing is sortable.
 */
function blockColumns(linkQuery: LinkQuery): readonly DataTableColumn<UserActivityBlockDto>[] {
  return [
    {
      id: 'start',
      header: 'Start',
      className: COLUMN_WIDTH.clock,
      cell: (row) => <span className="tabular">{formatClockTime(row.startAt)}</span>,
    },
    {
      id: 'end',
      header: 'End',
      className: COLUMN_WIDTH.clock,
      cell: (row) => <span className="tabular">{formatClockTime(row.endAt)}</span>,
    },
    {
      id: 'length',
      header: 'Length',
      hint: metricInfo('activityBlock'),
      className: COLUMN_WIDTH.length,
      cell: (row) => <span className="tabular">{formatHoursMinutes(row.spanMs)}</span>,
    },
    {
      id: 'timeInApp',
      header: METRIC_COPY.timeInApp.label,
      hint: metricInfo('timeInApp'),
      align: 'right',
      className: COLUMN_WIDTH.time,
      cell: (row) => formatHoursMinutes(row.timeInAppMs),
    },
    {
      id: 'tabVisible',
      header: METRIC_COPY.activeTime.label,
      hint: metricInfo('activeTime'),
      align: 'right',
      className: COLUMN_WIDTH.time,
      cell: (row) => formatHoursMinutes(row.activeMs),
    },
    {
      id: 'apps',
      header: 'Apps',
      cell: (row) => (
        <span className="flex min-w-0 flex-wrap gap-1">
          {row.apps.map((app) => (
            <AppChip key={app} app={app} linkQuery={linkQuery} className="min-w-0" />
          ))}
        </span>
      ),
    },
    {
      id: 'pageViews',
      header: METRIC_COPY.pageViews.label,
      align: 'right',
      className: COLUMN_WIDTH.count,
      cell: (row) => formatInteger(row.pageViews),
    },
    {
      id: 'featureUses',
      header: METRIC_COPY.featureUses.label,
      align: 'right',
      className: COLUMN_WIDTH.count,
      cell: (row) => formatInteger(row.toolUses),
    },
    {
      id: 'requests',
      header: METRIC_COPY.requests.label,
      align: 'right',
      className: COLUMN_WIDTH.count,
      cell: (row) => formatInteger(row.requests),
    },
  ];
}

/** WHY: the text twin of the day timeline (which is decorative) — every block with its facts. */
export function UserDayBlocksTable({
  blocks,
  linkQuery,
}: {
  blocks: readonly UserActivityBlockDto[];
  linkQuery: LinkQuery;
}) {
  return (
    <DataTable
      caption="Activity blocks"
      layout="fit"
      tableClassName={blocks.length > 0 ? DAY_BLOCKS_TABLE_MIN_WIDTH_CLASS : undefined}
      columns={blockColumns(linkQuery)}
      rows={blocks}
      rowKey={(row) => row.startAt}
      empty={
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          No browser activity on this day: only API calls.
        </p>
      }
    />
  );
}
