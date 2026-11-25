'use client';

import {
  reportingDayOf,
  reportingDayWindow,
  type TimeWindowQuery,
  type UserDayDetailDto,
} from '@nexus/shared';
import {
  AppWindow,
  ArrowLeft,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  MousePointerClick,
  Sunrise,
  Sunset,
  Waypoints,
} from 'lucide-react';
import Link from 'next/link';
import { useId, useMemo, useState } from 'react';

import { EmptyState } from '@/components/EmptyState';
import { InfoTip } from '@/components/InfoTip';
import { KpiCard } from '@/components/KpiCard';
import { ListSkeleton, Panel } from '@/components/Panel';
import { QueryState } from '@/components/QueryState';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { filterLinkQuery } from '@/features/filters/useGlobalFilters';
import {
  formatClockTime,
  formatDay,
  formatHoursMinutes,
  formatInteger,
  withUnit,
} from '@/lib/format';
import { METRIC_COPY, metricInfo } from '@/lib/metricCopy';
import { PAGES, withQuery } from '@/lib/pages';

import { AboutTheseNumbers } from './AboutTheseNumbers';
import {
  countLabel,
  dayNavigation,
  dayVisitsQuery,
  isOpenableDay,
  timeInAppLabel,
} from './dailyActivity';
import { DayTimeline } from './DayTimeline';
import { UserDayAppsTable } from './UserDayAppsTable';
import { UserDayBlocksTable } from './UserDayBlocksTable';
import { UserDayPagesTable } from './UserDayPagesTable';
import { UserDayToolsTable } from './UserDayToolsTable';
import { UserDayVisitsTable } from './UserDayVisitsTable';
import { useUserDetailDay } from './userDetailParams';
import { useUserDay } from './useUserDay';

type LinkQuery = Readonly<Record<string, string | undefined>>;

const MORE_LINK_CLASS =
  'rounded-sm font-medium text-link underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60';

/**
 * WHY: ONE IST day of one person as plain facts, in the order things happened: when activity
 * started and ended, how long a page was on screen (once per moment: Time in app; per tab: Tab
 * visible time), the activity blocks on a 00:00-24:00 timeline, the apps, pages and features in
 * first-use order and the visits newest first, each opening its Visit steps over this day. The
 * app and environment filters apply; the global range does not (the day is the window). An empty
 * day says so and keeps Previous / Next working; the API records the open either way. The page
 * visibly ends ("End of day · …") and states the limits of the numbers (AboutTheseNumbers). A day
 * outside [today − USER_DAY_LOOKBACK_DAYS, today] (an edited or old link) sends no read: the API
 * would refuse it, so the view says which days it shows and offers today instead.
 * Nothing here compares this person with anyone else (ADR 0017).
 */
export function UserDayDetail({
  userKey,
  day,
  filters,
}: {
  userKey: string;
  day: string;
  filters: TimeWindowQuery;
}) {
  const { setDay } = useUserDetailDay();
  // The IST day of "now" when the view opened: Today / Next stay consistent while it is open.
  const [today] = useState(() => reportingDayOf(new Date()));
  const openable = isOpenableDay(day, today);
  const query = useMemo(() => ({ day, app: filters.app, env: filters.env }), [day, filters]);
  const detail = useUserDay(userKey, query, openable);
  const linkQuery = useMemo(() => filterLinkQuery(filters), [filters]);

  return (
    <div className="space-y-6">
      <DayHeader day={day} today={today} onDay={setDay} />
      {openable ? (
        <QueryState
          query={detail}
          skeleton={<DaySkeleton />}
          isEmpty={detail.data?.summary === null}
          empty={
            <Card>
              <EmptyState
                icon={CalendarClock}
                title="No activity on this day"
                description="This person has no recorded activity on this day for the selected app and environment."
              />
            </Card>
          }
        >
          {() =>
            detail.data ? (
              <DayBody detail={detail.data} userKey={userKey} linkQuery={linkQuery} />
            ) : null
          }
        </QueryState>
      ) : (
        <DayOutOfRange today={today} onDay={setDay} />
      )}
      <AboutTheseNumbers variant="day" />
    </div>
  );
}

/** "Thu, 19 Nov 2026" of an IST day (`YYYY-MM-DD`). */
function dayLabel(day: string): string {
  return formatDay(reportingDayWindow(day).from.toISOString());
}

/**
 * Back to all days, the day's title, Previous / Today / Next and a date input. Next is disabled
 * on today, Previous at the oldest day the view opens (USER_DAY_LOOKBACK_DAYS back).
 */
function DayHeader({
  day,
  today,
  onDay,
}: {
  day: string;
  today: string;
  onDay: (day: string | null) => void;
}) {
  const navigation = dayNavigation(day, today);
  const title = `${dayLabel(day)} (India time)`;
  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Button variant="ghost" size="sm" onClick={() => onDay(null)}>
          <ArrowLeft aria-hidden="true" /> All days
        </Button>
        <h2 className="min-w-0 grow text-base font-semibold">{title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={navigation.previous === null}
            onClick={() => navigation.previous && onDay(navigation.previous)}
          >
            <ChevronLeft aria-hidden="true" /> Previous day
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={navigation.isToday}
            onClick={() => onDay(today)}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={navigation.next === null}
            onClick={() => navigation.next && onDay(navigation.next)}
          >
            Next day <ChevronRight aria-hidden="true" />
          </Button>
          {/* key: a new day (buttons, back / forward) resets the draft to it. */}
          <DayPicker key={day} day={day} today={today} oldest={navigation.oldest} onDay={onDay} />
        </div>
      </div>
      <p className="text-2xs text-muted-foreground">
        This view shows one whole day; the range picker above does not change it.
      </p>
    </Card>
  );
}

/**
 * The date input. It holds a DRAFT: typing changes it segment by segment (each step is a
 * change event, often an out-of-range day such as month "1"), so nothing opens while typing. The
 * draft opens on Enter, on leaving the input, or with "Show day", and only when it is a day the
 * view can open; a day outside the range stays in the input as typed.
 */
function DayPicker({
  day,
  today,
  oldest,
  onDay,
}: {
  day: string;
  today: string;
  oldest: string;
  onDay: (day: string) => void;
}) {
  const inputId = useId();
  const [draft, setDraft] = useState(day);
  const canOpen = draft !== day && isOpenableDay(draft, today);
  const openDraft = () => {
    if (canOpen) onDay(draft);
  };
  return (
    <>
      <label htmlFor={inputId} className="sr-only">
        Day to show
      </label>
      <Input
        id={inputId}
        type="date"
        className="h-7 w-40"
        value={draft}
        min={oldest}
        max={today}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={openDraft}
        onKeyDown={(event) => {
          if (event.key === 'Enter') openDraft();
        }}
      />
      <Button variant="outline" size="sm" disabled={!canOpen} onClick={openDraft}>
        Show day
      </Button>
    </>
  );
}

/** A day the view does not open (future, or older than the lookback): no read, a way back. */
function DayOutOfRange({ today, onDay }: { today: string; onDay: (day: string) => void }) {
  const { oldest } = dayNavigation(today, today);
  return (
    <Card>
      <EmptyState
        icon={CalendarClock}
        title="This day cannot be shown"
        description={`Pick a day from ${dayLabel(oldest)} to today.`}
        action={
          <Button variant="outline" size="sm" onClick={() => onDay(today)}>
            Show today
          </Button>
        }
      />
    </Card>
  );
}

/** The day's KPIs, timeline with blocks, apps, pages and features, visits and the end marker. */
function DayBody({
  detail,
  userKey,
  linkQuery,
}: {
  detail: UserDayDetailDto;
  userKey: string;
  linkQuery: LinkQuery;
}) {
  const summary = detail.summary;
  if (summary === null) return null;
  const visitsHref = withQuery(PAGES.journeys(), dayVisitsQuery(summary.day, linkQuery, userKey));
  const moreVisits = summary.visits - detail.visits.length;
  const morePages = detail.pagesTotal - detail.pages.length;
  const moreTools = detail.toolsTotal - detail.tools.length;
  return (
    <>
      <section
        aria-label="This day"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5"
      >
        <KpiCard
          label={METRIC_COPY.firstActivity.label}
          info={metricInfo('firstActivity')}
          icon={Sunrise}
          value={withUnit(formatClockTime(summary.firstActivityAt), 'IST')}
        />
        <KpiCard
          label={METRIC_COPY.lastActivity.label}
          info={metricInfo('lastActivity')}
          icon={Sunset}
          value={withUnit(formatClockTime(summary.lastActivityAt), 'IST')}
          hint={summary.inProgress ? 'so far' : undefined}
        />
        <KpiCard
          label={METRIC_COPY.timeInApp.label}
          info={metricInfo('timeInApp')}
          icon={Clock}
          value={timeInAppLabel(detail.timeInAppMs, summary.requests)}
          hint={`${METRIC_COPY.activeTime.label} ${formatHoursMinutes(summary.activeMs)}`}
        />
        <KpiCard label="Apps" icon={AppWindow} value={formatInteger(summary.perApp.length)} />
        <KpiCard
          label={METRIC_COPY.dayVisits.label}
          info={metricInfo('dayVisits')}
          icon={Waypoints}
          value={formatInteger(summary.visits)}
        />
      </section>

      <Panel
        title="Day timeline"
        icon={CalendarClock}
        description="The whole day, 00:00 to 24:00 India time. Each mark is an activity block: browser events with every break shorter than 5 minutes."
        contentClassName="space-y-4 px-0 pb-0"
      >
        <div className="px-4">
          <DayTimeline day={summary.day} blocks={detail.blocks} />
        </div>
        <UserDayBlocksTable blocks={detail.blocks} linkQuery={linkQuery} />
        <div className="space-y-1 border-t border-border px-4 py-3 text-2xs text-muted-foreground">
          {detail.requestsOutsideBlocks > 0 ? (
            <p className="flex items-center gap-1">
              <span>
                {METRIC_COPY.requestsOutsideBlocks.label}:{' '}
                <span className="tabular">{formatInteger(detail.requestsOutsideBlocks)}</span>
              </span>
              <InfoTip
                label={METRIC_COPY.requestsOutsideBlocks.label}
                text={metricInfo('requestsOutsideBlocks')}
              />
            </p>
          ) : null}
          {detail.blocksTruncated ? (
            <p>Showing the first {formatInteger(detail.blocks.length)} blocks of the day.</p>
          ) : null}
          <p>Block lengths are per block and are not added up.</p>
        </div>
      </Panel>

      <Panel
        title="Apps on this day"
        icon={AppWindow}
        description="Each app in the order it was first used that day."
        contentClassName="px-0 pb-0"
      >
        <UserDayAppsTable apps={summary.perApp} linkQuery={linkQuery} />
      </Panel>

      {/* grid-cols-1 = minmax(0, 1fr): below xl the tables scroll inside their panel, not the page. */}
      <div data-slot="day-pages-features" className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel
          title="Pages"
          icon={FileText}
          description="In the order they were first viewed."
          contentClassName="px-0 pb-0"
        >
          <UserDayPagesTable pages={detail.pages} linkQuery={linkQuery} />
          {morePages > 0 ? (
            <p className="border-t border-border px-4 py-3 text-2xs text-muted-foreground">
              +{formatInteger(morePages)} more pages on this day
            </p>
          ) : null}
        </Panel>
        <Panel
          title="Features used"
          icon={MousePointerClick}
          description="In the order they were first used."
          contentClassName="px-0 pb-0"
        >
          <UserDayToolsTable tools={detail.tools} linkQuery={linkQuery} />
          {moreTools > 0 ? (
            <p className="border-t border-border px-4 py-3 text-2xs text-muted-foreground">
              +{formatInteger(moreTools)} more features on this day
            </p>
          ) : null}
        </Panel>
      </div>

      <Panel
        title="Visits on this day"
        icon={Waypoints}
        description="Latest activity first. Visit steps opens the steps of one visit on this day."
        contentClassName="px-0 pb-0"
      >
        <UserDayVisitsTable visits={detail.visits} window={detail.window} linkQuery={linkQuery} />
        {moreVisits > 0 ? (
          <p className="border-t border-border px-4 py-3 text-2xs">
            <Link href={visitsHref} className={MORE_LINK_CLASS}>
              +{formatInteger(moreVisits)} more visits on this day
            </Link>
          </p>
        ) : null}
        <p
          data-slot="list-end"
          className="border-t border-border px-4 py-3 text-center text-2xs text-muted-foreground"
        >
          End of day · {countLabel(detail.blockCount, 'block', 'blocks')} ·{' '}
          {countLabel(summary.visits, 'visit', 'visits')}
        </p>
      </Panel>
    </>
  );
}

/** While the day loads: the KPI row and two panels, no data. */
function DaySkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <KpiCard key={index} label="" value="" loading />
        ))}
      </div>
      {['Day timeline', 'Apps on this day'].map((title) => (
        <Panel key={title} title={title}>
          <ListSkeleton rows={4} />
        </Panel>
      ))}
    </div>
  );
}
