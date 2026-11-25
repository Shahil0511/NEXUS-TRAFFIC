import type { UserDayVisitDto } from '@nexus/shared';
import Link from 'next/link';

import { AppChip } from '@/components/AppChip';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { EMPTY_VALUE, formatClockTime, formatHoursMinutes, formatInteger } from '@/lib/format';
import { METRIC_COPY, metricInfo } from '@/lib/metricCopy';

import { visitStepsHref } from './dailyActivity';

type LinkQuery = Readonly<Record<string, string | undefined>>;

const STEPS_LINK_CLASS =
  'rounded-sm font-medium text-link underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60';

/** Fixed widths of the 'fit' table; Entry → exit has none and takes the rest (39rem fixed). */
const COLUMN_WIDTH = {
  clock: 'w-20',
  app: 'w-28',
  count: 'w-20',
  tabVisible: 'w-24',
  steps: 'w-24',
} as const;

/** 39rem of fixed columns + at least 11rem for Entry → exit; below it the table scrolls in place. */
export const DAY_VISITS_TABLE_MIN_WIDTH_CLASS = 'min-w-[50rem]';

function visitColumns(
  window: { from: string; to: string },
  linkQuery: LinkQuery,
): readonly DataTableColumn<UserDayVisitDto>[] {
  return [
    {
      id: 'started',
      header: 'Started',
      className: COLUMN_WIDTH.clock,
      cell: (row) => <span className="tabular">{formatClockTime(row.startedAt)}</span>,
    },
    {
      id: 'last',
      header: METRIC_COPY.lastActivity.label,
      className: COLUMN_WIDTH.clock,
      cell: (row) => <span className="tabular">{formatClockTime(row.lastActivityAt)}</span>,
    },
    {
      id: 'app',
      header: 'App',
      className: COLUMN_WIDTH.app,
      cell: (row) => <AppChip app={row.app} linkQuery={linkQuery} className="min-w-0" />,
    },
    {
      id: 'path',
      header: 'Entry → exit',
      cell: (row) => (
        <span className="font-mono text-xs break-all">
          {row.entryPath ?? EMPTY_VALUE} → {row.exitPath ?? EMPTY_VALUE}
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
      id: 'tabVisible',
      header: METRIC_COPY.activeTime.label,
      hint: metricInfo('activeTime'),
      align: 'right',
      className: COLUMN_WIDTH.tabVisible,
      cell: (row) => formatHoursMinutes(row.activeMs),
    },
    {
      id: 'steps',
      header: 'Visit steps',
      className: COLUMN_WIDTH.steps,
      cell: (row) => (
        <Link href={visitStepsHref(row, window, linkQuery)} className={STEPS_LINK_CLASS}>
          Visit steps
          <span className="sr-only"> of the visit started {formatClockTime(row.startedAt)}</span>
        </Link>
      ),
    },
  ];
}

/**
 * WHY: the person's visits of the day, newest first — the same order as the Visits page, so its
 * "+N more" continues the list there. Each opens its Visit steps over THIS day (custom range).
 */
export function UserDayVisitsTable({
  visits,
  window,
  linkQuery,
}: {
  visits: readonly UserDayVisitDto[];
  window: { from: string; to: string };
  linkQuery: LinkQuery;
}) {
  return (
    <DataTable
      caption="Visits on this day"
      layout="fit"
      tableClassName={visits.length > 0 ? DAY_VISITS_TABLE_MIN_WIDTH_CLASS : undefined}
      columns={visitColumns(window, linkQuery)}
      rows={visits}
      rowKey={(row) => `${row.app}|${row.sessionId}`}
      empty={
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          No browser visits on this day: only API calls.
        </p>
      }
    />
  );
}
