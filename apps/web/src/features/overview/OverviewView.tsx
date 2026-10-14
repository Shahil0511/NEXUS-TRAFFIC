'use client';

import type { OverviewSummaryDto, TimeseriesPointDto } from '@nexus/shared';
import { Activity, ArrowRight, Eye, Gauge, Radio, TriangleAlert, UserCheck } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';

import { AppChip } from '@/components/AppChip';
import { ChartLegend } from '@/components/charts/ChartLegend';
import { ERROR_SERIES, ErrorsChart } from '@/components/charts/ErrorsChart';
import { LatencyChart } from '@/components/charts/LatencyChart';
import { TrafficChart } from '@/components/charts/TrafficChart';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { KpiCard } from '@/components/KpiCard';
import { PageHeader } from '@/components/PageHeader';
import { ChartSkeleton, ListSkeleton, Panel } from '@/components/Panel';
import { QueryState } from '@/components/QueryState';
import { Button } from '@/components/ui/button';
import { useAppTraffic } from '@/features/applications/useAppTraffic';
import { TopFailingEndpoints } from '@/features/errors/TopFailingEndpoints';
import { useErrorSummary } from '@/features/errors/useErrorSummary';
import { filterLinkQuery, useGlobalFilters } from '@/features/filters/useGlobalFilters';
import {
  formatCompact,
  formatDuration,
  formatInteger,
  formatPercent,
  formatWindowCaption,
} from '@/lib/format';
import { PAGES, withQuery } from '@/lib/pages';

import { useOverviewSummary } from './useOverviewSummary';
import { useOverviewTimeseries } from './useOverviewTimeseries';

/** True when no bucket has any request or page view — show the empty state, not flat lines. */
export function hasNoTraffic(points: readonly TimeseriesPointDto[]): boolean {
  return points.every((point) => point.requests === 0 && point.pageViews === 0);
}

/** True when there is traffic but no failures (the errors chart would be an empty frame). */
function hasNoErrors(points: readonly TimeseriesPointDto[]): boolean {
  return points.every((point) => point.errors4xx === 0 && point.errors5xx === 0);
}

/** How many apps the Overview's "Applications" panel previews (busiest first). */
const TOP_APPS = 5;

/**
 * The Overview page: headline KPIs with deltas (each card opens its breakdown), traffic / error /
 * latency charts, the busiest applications and the routes that fail most — the "is everything
 * OK?" screen.
 *
 * WHY THREE QUERIES: summary (KPIs), timeseries (charts) and errors.summary (top failing routes)
 * load and fail independently, so one slow panel never blanks the page. All three are keyed by
 * the global filters from the URL.
 */
export function OverviewView() {
  const { filters } = useGlobalFilters();
  const summary = useOverviewSummary(filters);
  const timeseries = useOverviewTimeseries(filters);
  const errors = useErrorSummary(filters);
  const linkQuery = useMemo(() => filterLinkQuery(filters), [filters]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description={
          summary.data
            ? formatWindowCaption(summary.data.window)
            : 'Traffic across your apps at a glance'
        }
      />

      <KpiGrid summary={summary.data} loading={summary.isPending} linkQuery={linkQuery} />
      {summary.isError ? (
        <ErrorState
          error={summary.error}
          title="Could not load the headline numbers"
          onRetry={() => void summary.refetch()}
          className="rounded-xl ring-1 ring-border"
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Requests" description="API calls per bucket" className="lg:col-span-2">
          <QueryState
            query={timeseries}
            skeleton={<ChartSkeleton />}
            isEmpty={timeseries.data ? hasNoTraffic(timeseries.data.points) : false}
            empty={
              <EmptyState
                title="No traffic in this window"
                description="Try a longer range or another app."
              />
            }
          >
            {() => (
              <TrafficChart
                points={timeseries.data!.points}
                grain={timeseries.data!.window.grain}
              />
            )}
          </QueryState>
        </Panel>
        <Panel
          title="Errors"
          description="Failed requests by class"
          aside={<ChartLegend series={ERROR_SERIES} />}
        >
          <QueryState
            query={timeseries}
            skeleton={<ChartSkeleton />}
            isEmpty={timeseries.data ? hasNoErrors(timeseries.data.points) : false}
            empty={
              <EmptyState title="No errors" description="Every request in this window succeeded." />
            }
          >
            {() => (
              <ErrorsChart points={timeseries.data!.points} grain={timeseries.data!.window.grain} />
            )}
          </QueryState>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title="Latency"
          description="p95 per bucket (streams excluded)"
          className="lg:col-span-2"
        >
          <QueryState
            query={timeseries}
            skeleton={<ChartSkeleton />}
            isEmpty={
              timeseries.data ? timeseries.data.points.every((p) => p.p95Ms === null) : false
            }
          >
            {() => (
              <LatencyChart
                points={timeseries.data!.points}
                grain={timeseries.data!.window.grain}
              />
            )}
          </QueryState>
        </Panel>
        <Panel
          title="Top failing routes"
          description="Most 4xx + 5xx responses"
          aside={
            <Button asChild variant="ghost" size="sm">
              <Link href={withQuery(PAGES.errors(), linkQuery)}>All errors</Link>
            </Button>
          }
        >
          <QueryState query={errors} skeleton={<ListSkeleton />}>
            {() => <TopFailingEndpoints endpoints={errors.data!.topEndpoints} filters={filters} />}
          </QueryState>
        </Panel>
      </div>

      <AppsPanel filters={filters} linkQuery={linkQuery} />
    </div>
  );
}

// ─── Applications at a glance ────────────────────────────────────────────────

/**
 * WHY: "which app is busy, which one is failing, how many people use each" without leaving the
 * Overview — the top of the Applications table, each app one click from its own page.
 */
function AppsPanel({
  filters,
  linkQuery,
}: {
  filters: Parameters<typeof useAppTraffic>[0];
  linkQuery: Record<string, string | undefined>;
}) {
  const apps = useAppTraffic(filters);
  const items = apps.data?.items.slice(0, TOP_APPS);
  return (
    <Panel
      title="Applications"
      description="Busiest first: users, API calls and error rate per app"
      aside={
        <Button asChild variant="ghost" size="sm">
          <Link href={withQuery(PAGES.applications(), { ...linkQuery, app: undefined })}>
            All applications <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      }
    >
      <QueryState
        query={apps}
        skeleton={<ListSkeleton />}
        isEmpty={items?.length === 0}
        empty={<EmptyState title="No apps registered yet" />}
      >
        {() => (
          <ul className="divide-y divide-border" aria-label="Applications">
            {items!.map((app) => (
              <li key={app.app} className="flex flex-wrap items-center gap-x-6 gap-y-1 py-2.5">
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <Link
                    href={withQuery(PAGES.applicationDetail(app.app), {
                      ...linkQuery,
                      app: undefined,
                    })}
                    className="truncate rounded-sm font-medium outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    {app.displayName}
                  </Link>
                  <AppChip app={app.app} linkQuery={linkQuery} className="hidden sm:inline-flex" />
                </span>
                <dl className="flex items-center gap-6 text-xs">
                  <div className="text-right">
                    <dt className="text-muted-foreground">Users</dt>
                    <dd className="font-semibold tabular">{formatInteger(app.users.value)}</dd>
                  </div>
                  <div className="text-right">
                    <dt className="text-muted-foreground">API calls</dt>
                    <dd className="font-semibold tabular">{formatCompact(app.requests.value)}</dd>
                  </div>
                  <div className="text-right">
                    <dt className="text-muted-foreground">Errors</dt>
                    <dd className="font-semibold tabular">{formatPercent(app.errorRate.value)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </Panel>
  );
}

// ─── KPI row ─────────────────────────────────────────────────────────────────

function KpiGrid({
  summary,
  loading,
  linkQuery,
}: {
  summary: OverviewSummaryDto | undefined;
  loading: boolean;
  linkQuery: Record<string, string | undefined>;
}) {
  if (!loading && !summary) return null;
  return (
    <section
      aria-label="Key metrics"
      className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6"
    >
      <KpiCard
        label="Requests"
        icon={Activity}
        loading={loading}
        value={formatCompact(summary?.requests.value)}
        deltaPct={summary?.requests.deltaPct ?? null}
        hint={summary ? `${formatInteger(summary.requests.value)} total` : undefined}
        href={withQuery(PAGES.endpoints(), linkQuery)}
      />
      <KpiCard
        label="Error rate"
        icon={TriangleAlert}
        loading={loading}
        value={formatPercent(summary?.errorRate.value)}
        deltaPct={summary?.errorRate.deltaPct ?? null}
        polarity="down-is-good"
        href={withQuery(PAGES.errors(), linkQuery)}
      />
      <KpiCard
        label="p95 latency"
        icon={Gauge}
        loading={loading}
        value={formatDuration(summary?.p95Ms.value)}
        deltaPct={summary?.p95Ms.deltaPct ?? null}
        polarity="down-is-good"
        href={withQuery(PAGES.endpoints(), { ...linkQuery, sort: 'p95' })}
      />
      <KpiCard
        label="Active users now"
        icon={Radio}
        loading={loading}
        value={formatInteger(summary?.activeUsersNow)}
        hint="last 5 minutes"
        href={withQuery(PAGES.live(), { app: linkQuery.app })}
      />
      <KpiCard
        label="Page views"
        icon={Eye}
        loading={loading}
        value={formatCompact(summary?.pageViews.value)}
        deltaPct={summary?.pageViews.deltaPct ?? null}
        href={withQuery(PAGES.pages(), linkQuery)}
      />
      <KpiCard
        label="Identified users"
        icon={UserCheck}
        loading={loading}
        value={formatInteger(summary?.identifiedUsers.value)}
        deltaPct={summary?.identifiedUsers.deltaPct ?? null}
        href={withQuery(PAGES.users(), linkQuery)}
      />
    </section>
  );
}
