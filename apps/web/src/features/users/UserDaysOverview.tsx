'use client';

import type { TimeWindowQuery } from '@nexus/shared';
import { CalendarDays, ChartColumn, Clock, Sunrise, Sunset } from 'lucide-react';
import { useMemo } from 'react';

import { DailyBarChart } from '@/components/charts/DailyBarChart';
import { DataTable } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { KpiCard } from '@/components/KpiCard';
import { Panel } from '@/components/Panel';
import { WidenRangeButton } from '@/components/WidenRangeButton';
import { filterLinkQuery } from '@/features/filters/useGlobalFilters';
import { USUAL_ACTIVITY_HOURS_ENABLED } from '@/lib/featureFlags';
import { formatClockOffset, formatHoursMinutes, formatInteger, withUnit } from '@/lib/format';
import { METRIC_COPY, metricInfo } from '@/lib/metricCopy';

import { AboutTheseNumbers } from './AboutTheseNumbers';
import {
  averageLastLabel,
  countLabel,
  fillReportingDays,
  summarizeDays,
  trendPointNotes,
} from './dailyActivity';
import { DAILY_TABLE_MIN_WIDTH_CLASS, dailyColumns } from './userDailyColumns';
import { useUserDaily } from './useUserDaily';
import { UsualActivityHoursPanel } from './UsualActivityHoursPanel';

/**
 * WHY: every day (India time) with any activity in the global range, as plain facts of this one
 * person — when activity started and ended, how long an app page was on screen, which apps, how
 * many pages, features, calls and visits, per app in first-use order — plus the totals of the
 * range and one bar per day of the tab visible time (idle days drawn as 0). Days without activity
 * are left out of the table. The list visibly ends ("End of list · N days") and the limits of the
 * numbers are stated under it (AboutTheseNumbers). Tab visible time is added up over days;
 * nothing here compares this person with anyone else (ADR 0017). The usual-activity-hours grid
 * (UsualActivityHoursPanel) sits between the list and the caveats, only while
 * USUAL_ACTIVITY_HOURS_ENABLED is on; it loads after the daily read succeeded.
 */
export function UserDaysOverview({
  userKey,
  filters,
}: {
  userKey: string;
  filters: TimeWindowQuery;
}) {
  const daily = useUserDaily(userKey, filters);
  const days = daily.data?.items;
  const totals = useMemo(() => summarizeDays(days ?? []), [days]);
  const dayWindow = daily.data?.window;
  const trend = useMemo(
    () => (days && dayWindow ? fillReportingDays(days, dayWindow) : []),
    [days, dayWindow],
  );
  const linkQuery = useMemo(() => filterLinkQuery(filters), [filters]);
  const columns = useMemo(() => dailyColumns(userKey, linkQuery), [userKey, linkQuery]);
  const loading = daily.isPending;

  if (daily.isError) {
    return <ErrorState error={daily.error} onRetry={() => void daily.refetch()} />;
  }
  return (
    <div className="space-y-6">
      <section aria-label="Daily activity totals" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard
          label={METRIC_COPY.daysActive.label}
          info={metricInfo('daysActive')}
          icon={CalendarDays}
          value={formatInteger(totals.activeDays)}
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
          label={METRIC_COPY.activeTime.label}
          info={metricInfo('activeTime')}
          icon={Clock}
          value={formatHoursMinutes(totals.totalTabVisibleMs)}
          hint="added up over the active days"
          loading={loading}
        />
      </section>

      {days && days.length > 0 ? (
        <Panel
          title="Tab visible time per day"
          icon={ChartColumn}
          description="How long app pages were on screen in a front browser tab, per day (India time)."
        >
          <DailyBarChart
            points={trend}
            label={METRIC_COPY.activeTime.label}
            format={formatHoursMinutes}
            notes={trendPointNotes}
          />
        </Panel>
      ) : null}

      <Panel
        title="Daily activity"
        icon={CalendarDays}
        description="One row per day (India time) with any activity, newest first. The bar is the whole day, 00:00 to 24:00; the marked part runs from the first to the last activity. Today is not over yet, so its last activity is so far."
        contentClassName="px-0 pb-0"
      >
        <DataTable
          caption="Daily activity"
          layout="fit"
          // Only with rows: an empty table fits the panel, so its message and action stay in view.
          tableClassName={days && days.length > 0 ? DAILY_TABLE_MIN_WIDTH_CLASS : undefined}
          columns={columns}
          rows={days}
          rowKey={(row) => row.day}
          loading={loading}
          empty={<EmptyState title="No activity in this range" action={<WidenRangeButton />} />}
        />
        {days && days.length > 0 ? (
          <p
            data-slot="list-end"
            className="border-t border-border px-4 py-3 text-center text-2xs text-muted-foreground"
          >
            End of list · {countLabel(days.length, 'day', 'days')}
          </p>
        ) : null}
      </Panel>

      {USUAL_ACTIVITY_HOURS_ENABLED ? (
        <UsualActivityHoursPanel userKey={userKey} filters={filters} dailyReady={daily.isSuccess} />
      ) : null}

      <AboutTheseNumbers variant="days" />
    </div>
  );
}
