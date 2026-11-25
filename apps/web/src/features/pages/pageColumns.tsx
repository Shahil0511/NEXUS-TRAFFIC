import type { PageStatsDto } from '@nexus/shared';

import { AppChip } from '@/components/AppChip';
import type { DataTableColumn } from '@/components/DataTable';
import { PageLink } from '@/components/EntityLinks';
import { formatDuration, formatInteger, formatPercent } from '@/lib/format';
import { metricInfo } from '@/lib/metricCopy';

import { exitRateOf } from './pageHeadline';
import type { PageSort } from './pageSort';

type LinkQuery = Readonly<Record<string, string | undefined>>;

/**
 * WHY: the columns of every list of pages (the Pages list; exported so the App profile can
 * reuse them, B8-7). The first column is the page's signature: its template in mono (opens the page) over its app chip.
 * Every number column carries a `sortKey` (PAGE_SORT_VALUES); a table without `onSortChange`
 * shows plain headers. Links carry `linkQuery` (the page's filters).
 */
export function pageColumns(linkQuery: LinkQuery): DataTableColumn<PageStatsDto, PageSort>[] {
  return [
    {
      id: 'page',
      header: 'Page',
      className: 'w-full min-w-48 max-w-0',
      cell: (row) => (
        <span className="block min-w-0 space-y-1">
          <PageLink
            app={row.app}
            pageId={row.pageId}
            pathTemplate={row.pathTemplate}
            linkQuery={linkQuery}
            className="block truncate text-xs"
          />
          <AppChip app={row.app} linkQuery={linkQuery} />
        </span>
      ),
    },
    {
      id: 'views',
      header: 'Views',
      sortKey: 'views',
      align: 'right',
      cell: (row) => formatInteger(row.views),
    },
    {
      id: 'sessions',
      header: 'Visits',
      sortKey: 'sessions',
      align: 'right',
      cell: (row) => formatInteger(row.uniqueSessions),
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
      id: 'avg',
      header: 'Average visible',
      sortKey: 'avg',
      hint: metricInfo('visibleTime'),
      align: 'right',
      cell: (row) => formatDuration(row.avgVisibleMs),
    },
    {
      id: 'p50',
      header: 'Median visible',
      sortKey: 'p50',
      hint: metricInfo('visibleTime'),
      align: 'right',
      cell: (row) => formatDuration(row.p50VisibleMs),
    },
    {
      id: 'exits',
      header: 'Exits',
      sortKey: 'exits',
      align: 'right',
      cell: (row) => (
        <span className="flex flex-col items-end">
          <span>{formatInteger(row.exits)}</span>
          <span className="text-2xs text-muted-foreground">
            {formatPercent(exitRateOf(row))}
            <span className="sr-only"> of visits</span>
          </span>
        </span>
      ),
    },
  ];
}
