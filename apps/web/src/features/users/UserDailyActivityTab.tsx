'use client';

import type { TimeWindowQuery, UserDayActivityDto } from '@nexus/shared';
import { CalendarDays, Clock, Sunrise, Sunset } from 'lucide-react';
import { useMemo } from 'react';

import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { KpiCard } from '@/components/KpiCard';
import { Panel } from '@/components/Panel';
import { WidenRangeButton } from '@/components/WidenRangeButton';
import {
  formatClockOffset,
  formatClockTime,
  formatDay,
  formatHoursMinutes,
  formatInteger,
  withUnit,
} from '@/lib/format';
import { METRIC_COPY, metricInfo } from '@/lib/metricCopy';

import { averageLastLabel, dayStripSpan, summarizeDays } from './dailyActivity';
import { useUserDaily } from './useUserDaily';

/** Hour marks drawn on the strip (06:00, 12:00, 18:00), in % of the day. */
const STRIP_TICKS_PCT = [25, 50, 75] as const;

/**
 * WHY: one row per day (India time) with any activity in the range — when it started, when it
 * ended, and how much of it a page was actually on screen — plus the totals of the range. Days
 * without activity are left out. Facts of this one person only.
 */
export function UserDailyActivityTab({
  userKey,
  filters,
}: {
  userKey: string;
  filters: TimeWindowQuery;
}) {
  const daily = useUserDaily(userKey, filters);
  const days = daily.data?.items;
  const totals = useMemo(() => summarizeDays(days ?? []), [days]);
  const loading = daily.isPending;

  if (daily.isError) {
    return <ErrorState error={daily.error} onRetry={() => void daily.refetch()} />;
  }
  return (
    <div className="space-y-6">
      <section aria-label="Daily activity totals" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard
          label="Days active"
          info={metricInfo('daysActive')}
          icon={CalendarDays}
          value={formatInteger(totals.daysActive)}
          hint="in the selected range"
          loading={loading}
        />
        <KpiCard
          label="Average first activity"
          info={metricInfo('firstActivity')}
          icon={Sunrise}
          value={withUnit(formatClockOffset(totals.averageFirstMs), 'IST')}
          hint="over the active days"
          loading={loading}
        />
        <KpiCard
          label="Average last activity"
          info={metricInfo('lastActivity')}
          icon={Sunset}
          value={averageLastLabel(totals)}
          hint="over the active days that have ended"
          loading={loading}
        />
        <KpiCard
          label="Total active time"
          info={metricInfo('activeTime')}
          icon={Clock}
          value={formatHoursMinutes(totals.totalActiveMs)}
          hint="tab visible"
          loading={loading}
        />
      </section>

      <Panel
        title="Daily activity"
        icon={CalendarDays}
        description="One row per day (India time) with any activity, newest first. The bar is the whole day, 00:00 to 24:00; the marked part runs from the first to the last activity. Today is not over yet, so its last activity is so far."
        contentClassName="px-0 pb-0"
      >
        <DataTable
          caption="Daily activity"
          columns={DAILY_COLUMNS}
          rows={days}
          rowKey={(row) => row.day}
          loading={loading}
          empty={<EmptyState title="No activity in this range" action={<WidenRangeButton />} />}
        />
      </Panel>
    </div>
  );
}

/**
 * WHY so few columns: the tab shares the page with the identity card, so the table must fit
 * without sideways scrolling from 1280 px. First and last activity sit above their own day bar
 * (one column instead of three), and failed requests sit under the request count.
 */
const DAILY_COLUMNS: readonly DataTableColumn<UserDayActivityDto>[] = [
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
    id: 'active',
    header: 'Active time',
    hint: metricInfo('activeTime'),
    align: 'right',
    cell: (row) => <span className="whitespace-nowrap">{formatHoursMinutes(row.activeMs)}</span>,
  },
  {
    id: 'pageViews',
    header: 'Page views',
    align: 'right',
    cell: (row) => <span className="tabular">{formatInteger(row.pageViews)}</span>,
  },
  {
    id: 'requests',
    header: METRIC_COPY.requests.label,
    hint: `${metricInfo('requests')} The line under the count says how many failed (HTTP status 400 or higher).`,
    align: 'right',
    cell: (row) => (
      <span className="flex flex-col items-end gap-0.5">
        <span className="tabular">{formatInteger(row.requests)}</span>
        {row.failedRequests > 0 ? (
          <span className="text-2xs text-destructive tabular">
            {formatInteger(row.failedRequests)} failed
          </span>
        ) : null}
      </span>
    ),
  },
  {
    id: 'visits',
    header: 'Visits',
    hint: metricInfo('sessions'),
    align: 'right',
    cell: (row) => <span className="tabular">{formatInteger(row.visits)}</span>,
  },
];

/**
 * WHY: a whole IST day as one bar, so the reader sees at a glance WHEN in the day the activity
 * happened. Only the span first → last activity is marked (not what happened in between).
 * Decorative (aria-hidden): the times are printed as text right above it, so a label here only
 * read them twice (and lost the "so far" of today's row).
 */
export function DayStrip({
  day,
  firstAt,
  lastAt,
}: {
  day: string;
  firstAt: string;
  lastAt: string;
}) {
  const span = dayStripSpan(day, firstAt, lastAt);
  return (
    <div
      aria-hidden="true"
      data-slot="day-strip"
      className="relative h-3 w-full rounded-full bg-muted ring-1 ring-border ring-inset"
    >
      {STRIP_TICKS_PCT.map((tick) => (
        <span
          key={tick}
          aria-hidden="true"
          className="absolute inset-y-0 w-px bg-border"
          style={{ left: `${tick}%` }}
        />
      ))}
      <span
        aria-hidden="true"
        data-testid="day-strip-span"
        className="absolute inset-y-0 rounded-full bg-primary"
        style={{ left: `${span.startPct}%`, width: `${span.widthPct}%` }}
      />
    </div>
  );
}
