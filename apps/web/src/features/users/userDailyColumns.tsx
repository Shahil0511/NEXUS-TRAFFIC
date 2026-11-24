import type { UserDayActivityDto } from '@nexus/shared';
import Link from 'next/link';

import type { DataTableColumn } from '@/components/DataTable';
import { formatClockTime, formatDay, formatHoursMinutes, formatInteger } from '@/lib/format';
import { METRIC_COPY, metricInfo } from '@/lib/metricCopy';
import { PAGES, withQuery } from '@/lib/pages';

import { countLabel, dayVisitsQuery } from './dailyActivity';
import { DayAppList } from './DayAppList';
import { DayStrip } from './DayStrip';

type LinkQuery = Readonly<Record<string, string | undefined>>;

const VISITS_LINK_CLASS =
  'rounded-sm font-medium text-link tabular underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60';

/**
 * WHY so few columns: the tab shares the page with the identity card, so the table must fit
 * without sideways scrolling from 1280 px. First and last activity sit above their own day bar
 * (one column instead of three), and the page, feature and API call counts share one column.
 * Apps are one line per app in first-use order (DayAppList), with that app's own time and span.
 * Every column is a plain fact of the day: there is no sort key, no bar and no "top" framing.
 * The Visits count opens the Visits page narrowed to this person AND this one day (custom range,
 * dayVisitsQuery), keeping the current app and environment. Built from the opaque userKey only.
 */
export function dailyColumns(
  userKey: string,
  linkQuery: LinkQuery,
): readonly DataTableColumn<UserDayActivityDto>[] {
  return [
    {
      id: 'day',
      header: 'Date',
      cell: (row) => <span className="whitespace-nowrap">{formatDay(row.day)}</span>,
    },
    {
      id: 'span',
      header: 'First – last activity (IST)',
      hint: metricInfo('daySpan'),
      className: 'w-full min-w-40',
      cell: (row) => (
        <div className="space-y-1.5">
          <span className="block tabular whitespace-nowrap">
            {formatClockTime(row.firstActivityAt)} – {formatClockTime(row.lastActivityAt)}
            {row.inProgress ? <span className="text-muted-foreground"> so far</span> : null}
          </span>
          <DayStrip day={row.day} firstAt={row.firstActivityAt} lastAt={row.lastActivityAt} />
        </div>
      ),
    },
    {
      id: 'tabVisible',
      header: METRIC_COPY.activeTime.label,
      hint: metricInfo('activeTime'),
      align: 'right',
      cell: (row) => <span className="whitespace-nowrap">{formatHoursMinutes(row.activeMs)}</span>,
    },
    {
      id: 'apps',
      header: METRIC_COPY.dayApps.label,
      hint: metricInfo('dayApps'),
      cell: (row) => <DayAppList day={row} linkQuery={linkQuery} />,
    },
    {
      id: 'counts',
      header: METRIC_COPY.dayCounts.label,
      hint: metricInfo('dayCounts'),
      cell: (row) => <DayCounts row={row} />,
    },
    {
      id: 'visits',
      header: METRIC_COPY.dayVisits.label,
      hint: metricInfo('dayVisits'),
      align: 'right',
      cell: (row) => <DayVisitsLink row={row} userKey={userKey} linkQuery={linkQuery} />,
    },
  ];
}

/** "38 page views / 12 feature uses / 212 API calls · 3 failed", one fact per line. */
function DayCounts({ row }: { row: UserDayActivityDto }) {
  return (
    <span className="flex flex-col gap-0.5 text-xs whitespace-nowrap tabular">
      <span>{countLabel(row.pageViews, 'page view', 'page views')}</span>
      <span>{countLabel(row.toolUses, 'feature use', 'feature uses')}</span>
      <span>
        {countLabel(row.requests, 'API call', 'API calls')}
        {row.failedRequests > 0 ? (
          <span className="text-destructive"> · {formatInteger(row.failedRequests)} failed</span>
        ) : null}
      </span>
    </span>
  );
}

/**
 * The day's visit count as a link to those visits; a day without browser visits (API calls only)
 * has nothing to open, so its 0 is plain text.
 */
function DayVisitsLink({
  row,
  userKey,
  linkQuery,
}: {
  row: UserDayActivityDto;
  userKey: string;
  linkQuery: LinkQuery;
}) {
  if (row.visits === 0) return <span className="tabular">{formatInteger(row.visits)}</span>;
  return (
    <Link
      href={withQuery(PAGES.journeys(), dayVisitsQuery(row.day, linkQuery, userKey))}
      className={VISITS_LINK_CLASS}
    >
      {formatInteger(row.visits)}
      <span className="sr-only">
        {row.visits === 1 ? ' visit' : ' visits'} on {formatDay(row.day)}
      </span>
    </Link>
  );
}
