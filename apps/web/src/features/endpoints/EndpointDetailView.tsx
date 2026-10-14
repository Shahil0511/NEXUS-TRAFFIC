'use client';

import type { EndpointDetailDto } from '@nexus/shared';
import { Activity, Gauge, Hourglass, TriangleAlert, Users, Zap } from 'lucide-react';
import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';

import { AppChip } from '@/components/AppChip';
import { applicationCrumbs, Breadcrumbs } from '@/components/Breadcrumbs';
import { ChartLegend } from '@/components/charts/ChartLegend';
import { ERROR_SERIES, ErrorsChart } from '@/components/charts/ErrorsChart';
import { LatencyChart } from '@/components/charts/LatencyChart';
import { StatusBreakdown } from '@/components/charts/StatusBreakdown';
import { TrafficChart } from '@/components/charts/TrafficChart';
import { DataTable } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { KpiCard } from '@/components/KpiCard';
import { MethodBadge } from '@/components/MethodBadge';
import { PageHeader } from '@/components/PageHeader';
import { ChartSkeleton, ListSkeleton, Panel } from '@/components/Panel';
import { requestSampleColumns } from '@/components/requestSampleColumns';
import { TopUsersList } from '@/components/TopUsersList';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { filterLinkQuery, useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { formatDuration, formatInteger, formatPercent, formatWindowCaption } from '@/lib/format';
import { metricInfo } from '@/lib/metricCopy';
import { PAGES, withQuery } from '@/lib/pages';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

import { useEndpointDetail } from './useEndpointDetail';

/**
 * One API route: its KPIs, request / error / latency charts, status codes and slowest calls.
 * Reached ONLY through PAGES.endpointDetail(endpointId) — the opaque id, never the template.
 */
export function EndpointDetailView({ endpointId }: { endpointId: string }) {
  const { filters: globalFilters } = useGlobalFilters();
  // WHY: the endpointId is derived from (app, method, route) — it IS the app scope. A stale
  // ?app=other from a deep link must not 404 the route, so the fetch ignores the app filter.
  const fetchFilters = useMemo(() => ({ ...globalFilters, app: undefined }), [globalFilters]);
  const detail = useEndpointDetail(endpointId, fetchFilters);
  const endpoint = detail.data?.endpoint;
  // Once loaded, the route's app is the app scope of every link (crumbs, failures, callers),
  // like PageDetailView / ToolDetailView; until then the user's own filters are all we know.
  const endpointApp = endpoint?.app;
  const filters = useMemo(
    () => (endpointApp ? { ...globalFilters, app: endpointApp } : globalFilters),
    [globalFilters, endpointApp],
  );
  const linkQuery = useMemo(() => filterLinkQuery(filters), [filters]);
  // Where the route sits: its app (once known) › API Routes › the route itself.
  const backLink = (
    <Breadcrumbs
      items={[
        ...(endpoint ? applicationCrumbs(endpoint.app, linkQuery) : []),
        { label: 'API Routes', href: withQuery(PAGES.endpoints(), linkQuery) },
        { label: endpoint ? `${endpoint.method} ${endpoint.routeTemplate}` : 'Route' },
      ]}
    />
  );

  if (detail.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Route" eyebrow={backLink} />
        <Card>
          <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
        </Card>
      </div>
    );
  }
  return detail.isPending ? (
    <DetailSkeleton eyebrow={backLink} />
  ) : (
    <DetailContent detail={detail.data} linkQuery={linkQuery} eyebrow={backLink} />
  );
}

function DetailSkeleton({ eyebrow }: { eyebrow: ReactNode }) {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        {eyebrow}
        <Skeleton className="h-7 w-80" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <KpiCard key={index} label="" value="" loading />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Requests" className="lg:col-span-2">
          <ChartSkeleton />
        </Panel>
        <Panel title="Status codes">
          <ListSkeleton />
        </Panel>
      </div>
    </div>
  );
}

type LinkQuery = Readonly<Record<string, string | undefined>>;

interface DetailContentProps {
  detail: EndpointDetailDto;
  /** The global filters scoped to the route's app — every link on the page carries it. */
  linkQuery: LinkQuery;
  eyebrow: ReactNode;
}

function DetailContent({ detail, linkQuery, eyebrow }: DetailContentProps) {
  const { endpoint, window } = detail;
  const columns = useMemo(() => requestSampleColumns({ showRoute: false, linkQuery }), [linkQuery]);
  useDocumentTitle(`${endpoint.method} ${endpoint.routeTemplate}`);
  const failuresHref = withQuery(PAGES.errors(), {
    ...linkQuery,
    endpointId: endpoint.endpointId,
  });
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={eyebrow}
        title={endpoint.routeTemplate}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <MethodBadge method={endpoint.method} />
            <AppChip app={endpoint.app} linkQuery={linkQuery} />
            <span>{formatWindowCaption(window)}</span>
          </span>
        }
        actions={
          endpoint.errors4xx + endpoint.errors5xx > 0 ? (
            <Button asChild variant="outline">
              <Link href={failuresHref}>
                <TriangleAlert aria-hidden="true" /> View failures
              </Link>
            </Button>
          ) : null
        }
      />

      <section
        aria-label="Route metrics"
        className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6"
      >
        <KpiCard
          label="Calls"
          icon={Activity}
          value={formatInteger(endpoint.calls)}
          info={metricInfo('requests')}
        />
        <KpiCard
          label="Error rate"
          icon={TriangleAlert}
          value={formatPercent(endpoint.errorRate)}
          hint={`${formatInteger(endpoint.errors4xx)} 4xx · ${formatInteger(endpoint.errors5xx)} 5xx`}
          info={metricInfo('errorRate')}
        />
        <KpiCard
          label="Users"
          icon={Users}
          value={formatInteger(detail.uniqueUsers)}
          hint="verified callers"
          info={metricInfo('uniqueUsers')}
        />
        <KpiCard
          label="p50"
          icon={Zap}
          value={formatDuration(endpoint.p50Ms)}
          hint={`avg ${formatDuration(endpoint.avgMs)}`}
          info={metricInfo('p50')}
        />
        <KpiCard
          label="p95"
          icon={Gauge}
          value={formatDuration(endpoint.p95Ms)}
          info={metricInfo('p95')}
        />
        <KpiCard
          label="p99"
          icon={Hourglass}
          value={formatDuration(endpoint.p99Ms)}
          info={metricInfo('p99')}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Requests" description="Calls per bucket" className="lg:col-span-2">
          <TrafficChart points={detail.timeseries} grain={window.grain} />
        </Panel>
        <Panel title="Top callers" description="Verified users by calls to this route">
          <TopUsersList
            users={detail.topUsers}
            unit="calls"
            ariaLabel="Top callers"
            linkQuery={linkQuery}
            emptyTitle="No verified caller"
          />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Latency" description="p95 per bucket">
          <LatencyChart points={detail.timeseries} grain={window.grain} />
        </Panel>
        <Panel
          title="Errors"
          description="Failed requests by class"
          aside={<ChartLegend series={ERROR_SERIES} />}
        >
          {endpoint.errors4xx + endpoint.errors5xx > 0 ? (
            <ErrorsChart points={detail.timeseries} grain={window.grain} />
          ) : (
            <EmptyState title="No failures" description="Every call in this window succeeded." />
          )}
        </Panel>
        <Panel title="Status codes" description="Responses in this window">
          {detail.statusBreakdown.length > 0 ? (
            <StatusBreakdown items={detail.statusBreakdown} />
          ) : (
            <EmptyState title="No responses" />
          )}
        </Panel>
      </div>

      <Panel
        title="Slowest calls"
        description="The longest requests in this window"
        contentClassName="px-0 pb-0"
      >
        <DataTable
          caption="Slowest calls"
          columns={columns}
          rows={detail.slowest}
          rowKey={(row) => row.eventId}
          empty={<EmptyState title="No calls recorded" />}
        />
      </Panel>
    </div>
  );
}
