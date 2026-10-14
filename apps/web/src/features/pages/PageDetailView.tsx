'use client';

import type { PageDetailDto, PageLinkDto } from '@nexus/shared';
import { ArrowLeft, Clock, DoorOpen, Eye, Hourglass, UserCheck, Waypoints } from 'lucide-react';
import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';

import { AppChip } from '@/components/AppChip';
import { CountChart } from '@/components/charts/CountChart';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { KpiCard } from '@/components/KpiCard';
import { MethodBadge } from '@/components/MethodBadge';
import { PageHeader } from '@/components/PageHeader';
import { ChartSkeleton, Panel } from '@/components/Panel';
import { RankedList } from '@/components/RankedList';
import { TopUsersList } from '@/components/TopUsersList';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { filterLinkQuery, useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { formatDuration, formatInteger, formatPercent, formatWindowCaption } from '@/lib/format';
import { PAGES, withQuery } from '@/lib/pages';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

import { usePageDetail } from './usePageDetail';

type LinkQuery = Record<string, string | undefined>;

const PERCENT = 100;
/** Inline link inside a list row. */
const ROW_LINK =
  'rounded-sm outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/60';

/**
 * One page of one app: how often and how long it is viewed, by whom, which tools are used on it,
 * which API routes it calls and where people come from / go next. Reached ONLY through
 * PAGES.pageDetail(app, pageId) — the opaque id, never the template.
 */
export function PageDetailView({ app, pageId }: { app: string; pageId: string }) {
  const { filters: globalFilters } = useGlobalFilters();
  // The page belongs to ONE app: its slug (from the path) is the app scope of every link.
  const filters = useMemo(() => ({ ...globalFilters, app }), [globalFilters, app]);
  const linkQuery = useMemo(() => filterLinkQuery(filters), [filters]);
  const detail = usePageDetail(app, pageId, filters);
  useDocumentTitle(detail.data?.page.pathTemplate);

  const backLink = (
    <Link
      href={withQuery(PAGES.pages(), linkQuery)}
      className="inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <ArrowLeft className="size-3" aria-hidden="true" /> Pages & Tools
    </Link>
  );

  if (detail.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Page" eyebrow={backLink} />
        <Card>
          <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
        </Card>
      </div>
    );
  }
  if (detail.isPending) return <DetailSkeleton eyebrow={backLink} />;
  return <DetailContent detail={detail.data} linkQuery={linkQuery} eyebrow={backLink} />;
}

function DetailSkeleton({ eyebrow }: { eyebrow: ReactNode }) {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">{eyebrow}</div>
        <Skeleton className="h-7 w-80" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <KpiCard key={index} label="" value="" loading />
        ))}
      </div>
      <Panel title="Views over time">
        <ChartSkeleton />
      </Panel>
    </div>
  );
}

function DetailContent({
  detail,
  linkQuery,
  eyebrow,
}: {
  detail: PageDetailDto;
  linkQuery: LinkQuery;
  eyebrow: ReactNode;
}) {
  const { page, window } = detail;
  const exitRate = page.uniqueSessions > 0 ? (page.exits / page.uniqueSessions) * PERCENT : null;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={eyebrow}
        title={page.pathTemplate}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <AppChip app={page.app} linkQuery={linkQuery} />
            <span>{formatWindowCaption(window)}</span>
          </span>
        }
      />

      <section
        aria-label="Page metrics"
        className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6"
      >
        <KpiCard label="Views" icon={Eye} value={formatInteger(page.views)} />
        <KpiCard
          label="Users"
          icon={UserCheck}
          value={formatInteger(page.distinctUsers)}
          hint="verified"
        />
        <KpiCard label="Sessions" icon={Waypoints} value={formatInteger(page.uniqueSessions)} />
        <KpiCard
          label="Avg time visible"
          icon={Hourglass}
          value={formatDuration(page.avgVisibleMs)}
          hint="tab in foreground"
        />
        <KpiCard
          label="Median time visible"
          icon={Clock}
          value={formatDuration(page.p50VisibleMs)}
        />
        <KpiCard
          label="Exit rate"
          icon={DoorOpen}
          value={formatPercent(exitRate)}
          hint={`${formatInteger(page.exits)} sessions ended here`}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Views over time" className="lg:col-span-2">
          <CountChart
            points={detail.trend.map((point) => ({ bucket: point.bucket, count: point.views }))}
            grain={window.grain}
            label="Views"
          />
        </Panel>
        <Panel title="Who views it" description="Verified users by views">
          <TopUsersList
            users={detail.topUsers}
            unit="views"
            ariaLabel="Who views this page"
            linkQuery={linkQuery}
          />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Came from" description="The page just before, by sessions">
          <PageLinkList
            app={page.app}
            links={detail.cameFrom}
            linkQuery={linkQuery}
            empty="Entry page: nothing before it"
          />
        </Panel>
        <Panel title="Went to" description="The page just after, by sessions">
          <PageLinkList
            app={page.app}
            links={detail.wentTo}
            linkQuery={linkQuery}
            empty="Nothing after it in these sessions"
          />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Tools used on this page" description="UI features, by uses">
          {detail.tools.length > 0 ? (
            <RankedList
              ariaLabel="Tools used on this page"
              items={detail.tools.map((tool) => ({
                key: tool.toolId,
                label: (
                  <Link
                    href={withQuery(PAGES.toolDetail(page.app, tool.toolId), linkQuery)}
                    className={ROW_LINK}
                  >
                    {tool.tool}
                  </Link>
                ),
                sublabel: `${formatInteger(tool.users)} users`,
                value: tool.uses,
              }))}
            />
          ) : (
            <EmptyState
              title="No tool used here"
              description="No tracked tool was used on this page."
            />
          )}
        </Panel>
        <Panel title="API calls from this page" description="Routes called while the page was open">
          {detail.apiCalls.length > 0 ? (
            <RankedList
              ariaLabel="API calls from this page"
              items={detail.apiCalls.map((call) => ({
                key: call.endpointId,
                label: (
                  <Link
                    href={withQuery(PAGES.endpointDetail(call.endpointId), linkQuery)}
                    className={`inline-flex min-w-0 items-center gap-1.5 ${ROW_LINK}`}
                  >
                    <MethodBadge method={call.method} />
                    <span className="truncate font-mono">{call.routeTemplate}</span>
                  </Link>
                ),
                sublabel: `${formatInteger(call.failed)} failed · p95 ${formatDuration(call.p95Ms)}`,
                value: call.calls,
              }))}
            />
          ) : (
            <EmptyState
              title="No linked API calls"
              description="API calls are linked to a page only when the app's tracker sends the session headers."
            />
          )}
        </Panel>
      </div>
    </div>
  );
}

/** Neighbour pages (came from / went to), each opening its own page detail. */
function PageLinkList({
  app,
  links,
  linkQuery,
  empty,
}: {
  app: string;
  links: readonly PageLinkDto[];
  linkQuery: LinkQuery;
  empty: string;
}) {
  if (links.length === 0) return <EmptyState className="py-6" title={empty} />;
  return (
    <RankedList
      ariaLabel="Pages"
      format={(value) => `${formatInteger(value)} sessions`}
      items={links.map((link) => ({
        key: link.pageId,
        label: (
          <Link
            href={withQuery(PAGES.pageDetail(app, link.pageId), linkQuery)}
            className={`font-mono ${ROW_LINK}`}
          >
            {link.pathTemplate}
          </Link>
        ),
        value: link.sessions,
      }))}
    />
  );
}
