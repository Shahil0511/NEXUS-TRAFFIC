'use client';

import {
  USER_PATTERN_RANGE_VALUES,
  type TimeWindowQuery,
  type UserPatternQuery,
  type UserPatternRange,
} from '@nexus/shared';
import { CalendarClock } from 'lucide-react';
import { useMemo, useState } from 'react';

import { EmptyState } from '@/components/EmptyState';
import { Panel } from '@/components/Panel';
import { QueryState } from '@/components/QueryState';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { METRIC_COPY } from '@/lib/metricCopy';

import { countLabel } from './dailyActivity';
import { HourGrid } from './HourGrid';
import { useUserPattern } from './useUserPattern';

/** The grid's own range control (the global range does not apply here). */
const RANGE_LABELS: Record<UserPatternRange, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};
const RANGE_OPTIONS: readonly SegmentedOption<UserPatternRange>[] = USER_PATTERN_RANGE_VALUES.map(
  (value) => ({ value, label: RANGE_LABELS[value] }),
);
const DEFAULT_RANGE: UserPatternRange = '30d';
/**
 * What a range really covers: the API widens it to whole India-time days (wholeReportingDays), so
 * 7d is today and the 7 days before it (8 days) and 30d is 31 days. Said on screen, because a
 * cell's "of N Wednesdays" counts those days.
 */
const RANGE_SPANS: Record<UserPatternRange, string> = {
  '7d': 'today and the 7 days before it',
  '30d': 'today and the 30 days before it',
};

/** Under the grid: what the cells are made of and what they are not. */
export const USUAL_ACTIVITY_HOURS_FOOTNOTE =
  'Based on recorded API calls and browser events, India time. Not sign-in or sign-out times. Apps that call the server in the background can light up hours with no one at the screen.';

/**
 * WHY: the "Usual activity hours" panel of the Daily activity tab — in which weekday-hours this
 * person's activity was recorded over the last 7 or 30 days (its own control, default 30; app and
 * environment come from the global filter). It waits for the daily read (`dailyReady`), so opening
 * the page does not add a statement to the reads already running, and it sends nothing for a
 * viewer who is not an admin (useUserPattern). Rendered only while USUAL_ACTIVITY_HOURS_ENABLED is
 * on (UserDaysOverview).
 */
export function UsualActivityHoursPanel({
  userKey,
  filters,
  dailyReady,
}: {
  userKey: string;
  filters: TimeWindowQuery;
  dailyReady: boolean;
}) {
  const [range, setRange] = useState<UserPatternRange>(DEFAULT_RANGE);
  const query = useMemo<UserPatternQuery>(
    () => ({ range, app: filters.app, env: filters.env }),
    [range, filters.app, filters.env],
  );
  const pattern = useUserPattern(userKey, query, dailyReady);

  return (
    <Panel
      title={METRIC_COPY.usualActivityHours.label}
      icon={CalendarClock}
      description={METRIC_COPY.usualActivityHours.short}
      aside={
        <SegmentedControl
          ariaLabel="Range of the usual activity hours"
          value={range}
          options={RANGE_OPTIONS}
          onValueChange={setRange}
        />
      }
    >
      <div className="space-y-3">
        <QueryState
          query={pattern}
          skeleton={<Skeleton className="h-44 w-full" />}
          isEmpty={pattern.data?.activeDays === 0}
          empty={
            <EmptyState
              title={`No activity in the ${RANGE_LABELS[range].toLowerCase()}`}
              description="Nothing was recorded for this person in the selected app and environment."
            />
          }
        >
          {() =>
            pattern.data ? (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  {countLabel(pattern.data.activeDays, 'active day', 'active days')} over{' '}
                  {RANGE_SPANS[range]} (whole days, India time).
                </p>
                <HourGrid pattern={pattern.data} />
              </div>
            ) : null
          }
        </QueryState>
        <p data-slot="hour-grid-footnote" className="text-2xs text-muted-foreground">
          {USUAL_ACTIVITY_HOURS_FOOTNOTE}
        </p>
      </div>
    </Panel>
  );
}
