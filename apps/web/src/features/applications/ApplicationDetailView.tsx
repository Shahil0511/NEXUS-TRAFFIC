'use client';

import type { AppTrafficDto, TimeWindowDto, TimeWindowQuery } from '@nexus/shared';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Eye,
  Gauge,
  PlugZap,
  Radio,
  TriangleAlert,
  UserCheck,
  Waypoints,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';

import { UserLink } from '@/components/ActorCell';
import { TrafficChart } from '@/components/charts/TrafficChart';
import { EmptyState } from '@/components/EmptyState';
import { PageLink, ToolLink } from '@/components/EntityLinks';
import { ErrorState } from '@/components/ErrorState';
import { KpiCard } from '@/components/KpiCard';
import { MethodBadge } from '@/components/MethodBadge';
import { PageHeader } from '@/components/PageHeader';
import { ChartSkeleton, ListSkeleton, Panel } from '@/components/Panel';
import { QueryState } from '@/components/QueryState';
import { RankedList } from '@/components/RankedList';
import { RelativeTime } from '@/components/RelativeTime';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useEndpointStats } from '@/features/endpoints/useEndpointStats';
import { TopFailingEndpoints } from '@/features/errors/TopFailingEndpoints';
import { useErrorSummary } from '@/features/errors/useErrorSummary';
import { filterLinkQuery, useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { hasNoTraffic } from '@/features/overview/OverviewView';
import { useOverviewTimeseries } from '@/features/overview/useOverviewTimeseries';
import { usePageStats } from '@/features/pages/usePageStats';
import { useToolUsage } from '@/features/tools/useToolUsage';
import { useUserList } from '@/features/users/useUserList';
import {
  formatCompact,
  formatDuration,
  formatInteger,
  formatPercent,
  formatWindowCaption,
} from '@/lib/format';
import { PAGES, withQuery } from '@/lib/pages';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

import { useAppTraffic } from './useAppTraffic';

/** Rows of every "top N" panel on the page; "View all" opens the full list filtered to the app. */
const TOP_N = 8;

type LinkQuery = Record<string, string | undefined>;

/**
 * One application: who uses it, what they use (routes, pages, tools), what fails and how it
 * trends — each panel a preview of a full page, opened already filtered to this app. Reached
 * through PAGES.applicationDetail(app) with the REGISTERED slug (validated by the page file).
 */
export function ApplicationDetailView({ app }: { app: string }) {
  const { filters: globalFilters } = useGlobalFilters();
  // This page IS the app: its slug from the path overrides any global app filter.
  const filters = useMemo(() => ({ ...globalFilters, app }), [globalFilters, app]);
  const linkQuery = useMemo(() => filterLinkQuery(filters), [filters]);
  const traffic = useAppTraffic(filters);
  const row = traffic.data?.items[0];
  useDocumentTitle(row?.displayName ?? app);

  const backLink = (
    <Link
      href={withQuery(PAGES.applications(), { ...linkQuery, app: undefined })}
      className="inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <ArrowLeft className="size-3" aria-hidden="true" /> Applications
    </Link>
  );

  if (traffic.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title={app} eyebrow={backLink} />
        <Card>
          <ErrorState error={traffic.error} onRetry={() => void traffic.refetch()} />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {row ? (
        <AppHeader row={row} window={traffic.data!.window} eyebrow={backLink} />
      ) : (
        <div className="space-y-2" aria-busy="true">
          <div className="text-xs text-muted-foreground">{backLink}</div>
          <Skeleton className="h-7 w-64" />
        </div>
      )}
      <AppKpis row={row} linkQuery={linkQuery} />

      <div className="grid gap-4 lg:grid-cols-3">
        <ActivityPanel filters={filters} />
        <FailingRoutesPanel filters={filters} linkQuery={linkQuery} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <UsersPanel filters={filters} linkQuery={linkQuery} />
        <RoutesPanel filters={filters} linkQuery={linkQuery} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <PagesPanel filters={filters} linkQuery={linkQuery} />
        <ToolsPanel filters={filters} linkQuery={linkQuery} />
      </div>
    </div>
  );
}

// ─── Header + KPIs ───────────────────────────────────────────────────────────

function AppHeader({
  row,
  window,
  eyebrow,
}: {
  row: AppTrafficDto;
  window: TimeWindowDto;
  eyebrow: ReactNode;
}) {
  return (
    <PageHeader
      eyebrow={eyebrow}
      title={row.displayName}
      description={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-xs">{row.app}</span>
          <span aria-hidden="true">·</span>
          <span>{formatWindowCaption(window)}</span>
          <span aria-hidden="true">·</span>
          <span>
            last event <RelativeTime iso={row.lastEventAt} />
          </span>
        </span>
      }
      actions={
        <>
          <Button asChild variant="outline">
            <Link href={withQuery(PAGES.live(), { app: row.app })}>
              <Radio aria-hidden="true" /> Live
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={PAGES.integration()}>
              <PlugZap aria-hidden="true" /> Integration health
            </Link>
          </Button>
        </>
      }
    />
  );
}

function AppKpis({ row, linkQuery }: { row: AppTrafficDto | undefined; linkQuery: LinkQuery }) {
  const loading = row === undefined;
  return (
    <section
      aria-label="Application metrics"
      className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6"
    >
      <KpiCard
        label="Users"
        icon={UserCheck}
        loading={loading}
        value={formatInteger(row?.users.value)}
        deltaPct={row?.users.deltaPct ?? null}
        hint="verified"
        href={withQuery(PAGES.users(), linkQuery)}
      />
      <KpiCard
        label="API calls"
        icon={Activity}
        loading={loading}
        value={formatCompact(row?.requests.value)}
        deltaPct={row?.requests.deltaPct ?? null}
        href={withQuery(PAGES.endpoints(), linkQuery)}
      />
      <KpiCard
        label="Error rate"
        icon={TriangleAlert}
        loading={loading}
        value={formatPercent(row?.errorRate.value)}
        deltaPct={row?.errorRate.deltaPct ?? null}
        polarity="down-is-good"
        href={withQuery(PAGES.errors(), linkQuery)}
      />
      <KpiCard
        label="p95 latency"
        icon={Gauge}
        loading={loading}
        value={formatDuration(row?.p95Ms)}
        href={withQuery(PAGES.endpoints(), { ...linkQuery, sort: 'p95' })}
      />
      <KpiCard
        label="Page views"
        icon={Eye}
        loading={loading}
        value={formatCompact(row?.pageViews.value)}
        deltaPct={row?.pageViews.deltaPct ?? null}
        href={withQuery(PAGES.pages(), linkQuery)}
      />
      <KpiCard
        label="Sessions"
        icon={Waypoints}
        loading={loading}
        value={formatInteger(row?.sessions)}
        hint={row ? `${formatInteger(row.toolUses)} tool uses` : undefined}
        href={withQuery(PAGES.journeys(), linkQuery)}
      />
    </section>
  );
}

// ─── Panels ──────────────────────────────────────────────────────────────────

function ViewAll({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="ghost" size="sm">
      <Link href={href} aria-label={label}>
        View all <ArrowRight aria-hidden="true" />
      </Link>
    </Button>
  );
}

function ActivityPanel({ filters }: { filters: TimeWindowQuery }) {
  const timeseries = useOverviewTimeseries(filters);
  return (
    <Panel title="API calls over time" description="Requests per bucket" className="lg:col-span-2">
      <QueryState
        query={timeseries}
        skeleton={<ChartSkeleton />}
        isEmpty={timeseries.data ? hasNoTraffic(timeseries.data.points) : false}
        empty={
          <EmptyState
            title="No traffic in this window"
            description="Try a longer range, or check Integration health."
          />
        }
      >
        {() => (
          <TrafficChart points={timeseries.data!.points} grain={timeseries.data!.window.grain} />
        )}
      </QueryState>
    </Panel>
  );
}

function FailingRoutesPanel({
  filters,
  linkQuery,
}: {
  filters: TimeWindowQuery;
  linkQuery: LinkQuery;
}) {
  const errors = useErrorSummary(filters);
  return (
    <Panel
      title="Top failing routes"
      description="Most 4xx + 5xx responses"
      aside={<ViewAll href={withQuery(PAGES.errors(), linkQuery)} label="All errors of this app" />}
    >
      <QueryState query={errors} skeleton={<ListSkeleton />}>
        {() => <TopFailingEndpoints endpoints={errors.data!.topEndpoints} filters={filters} />}
      </QueryState>
    </Panel>
  );
}

function UsersPanel({ filters, linkQuery }: { filters: TimeWindowQuery; linkQuery: LinkQuery }) {
  // Most active first: the people who use this app the most.
  const users = useUserList({ ...filters, sort: 'requests', dir: 'desc', limit: TOP_N });
  const rows = users.data?.pages[0]?.items;
  return (
    <Panel
      title="Who uses it"
      description="Verified users, most active first"
      aside={<ViewAll href={withQuery(PAGES.users(), linkQuery)} label="All users of this app" />}
    >
      <QueryState
        query={users}
        skeleton={<ListSkeleton />}
        isEmpty={rows?.length === 0}
        empty={
          <EmptyState
            title="No identified users"
            description="Users appear once the app sends verified identities (SSO cookie or app-attested)."
          />
        }
      >
        {() => (
          <ul className="divide-y divide-border" aria-label="Users of this app">
            {rows!.map((user) => (
              <li key={user.userKey} className="flex items-center justify-between gap-3 py-2">
                <span className="flex min-w-0 flex-col">
                  <UserLink userKey={user.userKey} email={user.email} linkQuery={linkQuery} />
                  <span className="text-[11px] text-muted-foreground">
                    {formatInteger(user.requests)} API calls · {formatInteger(user.pageViews)} page
                    views · {formatInteger(user.sessions)} sessions
                  </span>
                </span>
                <RelativeTime
                  iso={user.lastSeenAt}
                  className="shrink-0 text-xs text-muted-foreground"
                />
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </Panel>
  );
}

function RoutesPanel({ filters, linkQuery }: { filters: TimeWindowQuery; linkQuery: LinkQuery }) {
  const routes = useEndpointStats({ ...filters, sort: 'calls', dir: 'desc', limit: TOP_N });
  const rows = routes.data?.pages[0]?.items;
  return (
    <Panel
      title="Most used API routes"
      description="By calls"
      aside={
        <ViewAll href={withQuery(PAGES.endpoints(), linkQuery)} label="All routes of this app" />
      }
    >
      <QueryState
        query={routes}
        skeleton={<ListSkeleton />}
        isEmpty={rows?.length === 0}
        empty={<EmptyState title="No API calls in this window" />}
      >
        {() => (
          <RankedList
            ariaLabel="Most used API routes"
            items={rows!.map((route) => ({
              key: route.endpointId,
              label: (
                <Link
                  href={withQuery(PAGES.endpointDetail(route.endpointId), linkQuery)}
                  className="inline-flex min-w-0 items-center gap-1.5 rounded-sm outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  <MethodBadge method={route.method} />
                  <span className="truncate font-mono">{route.routeTemplate}</span>
                </Link>
              ),
              sublabel: `${formatPercent(route.errorRate)} errors · p95 ${formatDuration(route.p95Ms)}`,
              value: route.calls,
            }))}
          />
        )}
      </QueryState>
    </Panel>
  );
}

function PagesPanel({ filters, linkQuery }: { filters: TimeWindowQuery; linkQuery: LinkQuery }) {
  const pages = usePageStats({ ...filters, limit: TOP_N });
  const rows = pages.data?.items;
  return (
    <Panel
      title="Most viewed pages"
      description="Page templates by views"
      aside={<ViewAll href={withQuery(PAGES.pages(), linkQuery)} label="All pages of this app" />}
    >
      <QueryState
        query={pages}
        skeleton={<ListSkeleton />}
        isEmpty={rows?.length === 0}
        empty={
          <EmptyState
            title="No page views"
            description="The browser tracker is not sending page views for this app yet."
          />
        }
      >
        {() => (
          <RankedList
            ariaLabel="Most viewed pages"
            items={rows!.map((page) => ({
              key: page.pageId,
              label: (
                <PageLink
                  app={page.app}
                  pageId={page.pageId}
                  pathTemplate={page.pathTemplate}
                  linkQuery={linkQuery}
                />
              ),
              sublabel: `${formatInteger(page.uniqueSessions)} sessions · avg ${formatDuration(page.avgVisibleMs)} visible`,
              value: page.views,
            }))}
          />
        )}
      </QueryState>
    </Panel>
  );
}

function ToolsPanel({ filters, linkQuery }: { filters: TimeWindowQuery; linkQuery: LinkQuery }) {
  const tools = useToolUsage({ ...filters, limit: TOP_N });
  const rows = tools.data?.items;
  return (
    <Panel
      title="Most used tools"
      description="UI features, by uses"
      aside={<ViewAll href={withQuery(PAGES.tools(), linkQuery)} label="All tools of this app" />}
    >
      <QueryState
        query={tools}
        skeleton={<ListSkeleton />}
        isEmpty={rows?.length === 0}
        empty={
          <EmptyState
            title="No tool uses"
            description="Tools appear once the app tracks feature clicks (tool_use events)."
          />
        }
      >
        {() => (
          <RankedList
            ariaLabel="Most used tools"
            items={rows!.map((tool) => ({
              key: tool.toolId,
              label: (
                <ToolLink
                  app={tool.app}
                  toolId={tool.toolId}
                  tool={tool.tool}
                  linkQuery={linkQuery}
                />
              ),
              sublabel: `${formatInteger(tool.distinctUsers)} users · ${formatInteger(tool.distinctSessions)} sessions`,
              value: tool.uses,
            }))}
          />
        )}
      </QueryState>
    </Panel>
  );
}
