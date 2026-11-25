import type { UserDayAppActivityDto } from '@nexus/shared';

import { AppChip } from '@/components/AppChip';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { formatClockTime, formatInteger } from '@/lib/format';
import { METRIC_COPY, metricInfo } from '@/lib/metricCopy';

import { appTimeLabel } from './dailyActivity';

type LinkQuery = Readonly<Record<string, string | undefined>>;

/** Fixed widths of the 'fit' table; App has none and takes the rest (38rem fixed). */
const COLUMN_WIDTH = {
  span: 'w-32',
  tabVisible: 'w-28',
  count: 'w-20',
  requests: 'w-32',
} as const;

/** 38rem of fixed columns + at least 10rem for App; below it the table scrolls in place. */
export const DAY_APPS_TABLE_MIN_WIDTH_CLASS = 'min-w-[48rem]';

function appColumns(linkQuery: LinkQuery): readonly DataTableColumn<UserDayAppActivityDto>[] {
  return [
    {
      id: 'app',
      header: 'App',
      cell: (row) => <AppChip app={row.app} linkQuery={linkQuery} className="min-w-0" />,
    },
    {
      id: 'span',
      header: 'First – last activity (IST)',
      hint: metricInfo('daySpan'),
      className: COLUMN_WIDTH.span,
      cell: (row) => (
        <span className="whitespace-nowrap tabular">
          {formatClockTime(row.firstActivityAt)} – {formatClockTime(row.lastActivityAt)}
        </span>
      ),
    },
    {
      id: 'tabVisible',
      header: METRIC_COPY.activeTime.label,
      hint: metricInfo('activeTime'),
      align: 'right',
      className: COLUMN_WIDTH.tabVisible,
      cell: (row) => appTimeLabel(row),
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
      className: COLUMN_WIDTH.requests,
      cell: (row) => (
        <span className="tabular">
          {formatInteger(row.requests)}
          {row.failedRequests > 0 ? (
            <span className="text-destructive"> · {formatInteger(row.failedRequests)} failed</span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'visits',
      header: METRIC_COPY.dayVisits.label,
      align: 'right',
      className: COLUMN_WIDTH.count,
      cell: (row) => formatInteger(row.visits),
    },
  ];
}

/**
 * WHY: the day per app, in the order the apps were first used that day (the API's perApp order),
 * never by time or counts. An app seen only through API calls shows "no browser time".
 */
export function UserDayAppsTable({
  apps,
  linkQuery,
}: {
  apps: readonly UserDayAppActivityDto[];
  linkQuery: LinkQuery;
}) {
  return (
    <DataTable
      caption="Apps on this day"
      layout="fit"
      tableClassName={DAY_APPS_TABLE_MIN_WIDTH_CLASS}
      columns={appColumns(linkQuery)}
      rows={apps}
      rowKey={(row) => row.app}
    />
  );
}
