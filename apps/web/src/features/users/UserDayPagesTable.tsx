import type { UserDayPageDto } from '@nexus/shared';

import { AppChip } from '@/components/AppChip';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { PageLink } from '@/components/EntityLinks';
import { formatClockTime, formatHoursMinutes, formatInteger } from '@/lib/format';
import { METRIC_COPY, metricInfo } from '@/lib/metricCopy';

type LinkQuery = Readonly<Record<string, string | undefined>>;

/** Fixed widths of the 'fit' table; Page has none and takes the rest (23rem fixed). */
const COLUMN_WIDTH = {
  app: 'w-32',
  clock: 'w-16',
  count: 'w-16',
  tabVisible: 'w-24',
} as const;

/** Half of the content width at 1280 px; below it the table scrolls in place. */
export const DAY_HALF_TABLE_MIN_WIDTH_CLASS = 'min-w-[28rem]';

function pageColumns(linkQuery: LinkQuery): readonly DataTableColumn<UserDayPageDto>[] {
  return [
    {
      id: 'app',
      header: 'App',
      className: COLUMN_WIDTH.app,
      cell: (row) => <AppChip app={row.app} linkQuery={linkQuery} className="min-w-0" />,
    },
    {
      id: 'page',
      header: 'Page',
      cell: (row) => (
        <PageLink
          app={row.app}
          pageId={row.pageId}
          pathTemplate={row.pathTemplate}
          linkQuery={linkQuery}
          className="wrap-break-word"
        />
      ),
    },
    {
      id: 'firstView',
      header: 'First view (IST)',
      className: COLUMN_WIDTH.clock,
      cell: (row) => <span className="tabular">{formatClockTime(row.firstViewAt)}</span>,
    },
    {
      id: 'views',
      header: METRIC_COPY.pageViews.label,
      align: 'right',
      className: COLUMN_WIDTH.count,
      cell: (row) => formatInteger(row.views),
    },
    {
      id: 'tabVisible',
      header: METRIC_COPY.activeTime.label,
      hint: metricInfo('activeTime'),
      align: 'right',
      className: COLUMN_WIDTH.tabVisible,
      cell: (row) => formatHoursMinutes(row.activeMs),
    },
  ];
}

/**
 * WHY: the pages of the day in the order they were first viewed (IST) — no bars, no "top", no
 * share of the day: the order of use, not a ranking. A page whose view began the day before has
 * no first view here ("—"), only its time.
 */
export function UserDayPagesTable({
  pages,
  linkQuery,
}: {
  pages: readonly UserDayPageDto[];
  linkQuery: LinkQuery;
}) {
  return (
    <DataTable
      caption="Pages"
      layout="fit"
      tableClassName={pages.length > 0 ? DAY_HALF_TABLE_MIN_WIDTH_CLASS : undefined}
      columns={pageColumns(linkQuery)}
      rows={pages}
      rowKey={(row) => `${row.app}|${row.pageId}`}
      empty={
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">No pages on this day.</p>
      }
    />
  );
}
