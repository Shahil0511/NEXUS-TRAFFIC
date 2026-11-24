'use client';

import type { TimeWindowQuery } from '@nexus/shared';
import { CalendarDays, Clock, Sunrise, Sunset } from 'lucide-react';
import { useMemo } from 'react';

import { DataTable } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { KpiCard } from '@/components/KpiCard';
import { Panel } from '@/components/Panel';
import { WidenRangeButton } from '@/components/WidenRangeButton';
import { filterLinkQuery } from '@/features/filters/useGlobalFilters';
import { formatClockOffset, formatHoursMinutes, formatInteger, withUnit } from '@/lib/format';
import { METRIC_COPY, metricInfo } from '@/lib/metricCopy';

import { AboutTheseNumbers } from './AboutTheseNumbers';
import { averageLastLabel, countLabel, summarizeDays } from './dailyActivity';
import { dailyColumns } from './userDailyColumns';
import { useUserDaily } from './useUserDaily';

/**
 * WHY: every day (India time) with any activity in the global range, as plain facts of this one
 * person — when activity started and ended, how long an app page was on screen, which apps, how
 * many pages, features, calls and visits — plus the totals of the range. Days without activity are
 * left out. The list visibly ends ("End of list · N days") and the limits of the numbers are
 * stated under it (AboutTheseNumbers). Tab visible time is added up over days; nothing here
 * compares this person with anyone else (ADR 0017).
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

      <Panel
        title="Daily activity"
        icon={CalendarDays}
        description="One row per day (India time) with any activity, newest first. The bar is the whole day, 00:00 to 24:00; the marked part runs from the first to the last activity. Today is not over yet, so its last activity is so far."
        contentClassName="px-0 pb-0"
      >
        <DataTable
          caption="Daily activity"
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

      <AboutTheseNumbers variant="days" />
    </div>
  );
}
