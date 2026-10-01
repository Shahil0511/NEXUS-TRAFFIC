'use client';

import type { EndpointDetailDto, TimeWindowQuery } from '@nexus/shared';
import { Activity, ArrowLeft, Gauge, Hourglass, Timer, TriangleAlert, Zap } from 'lucide-react';
import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';

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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { filterLinkQuery, useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { formatDuration, formatInteger, formatPercent, formatWindowCaption } from '@/lib/format';
import { PAGES, withQuery } from '@/lib/pages';

import { useEndpointDetail } from './useEndpointDetail';

/**
 * One API route: its KPIs, request / error / latency charts, status codes and slowest calls.
 * Reached ONLY through PAGES.endpointDetail(endpointId) — the opaque id, never the template.
 */
export function EndpointDetailView({ endpointId }: { endpointId: string }) {
  const { filters } = useGlobalFilters();
  const detail = useEndpointDetail(endpointId, filters);
  const linkQuery = filterLinkQuery(filters);
  const backLink = (
    <Link
      href={withQuery(PAGES.endpoints(), linkQuery)}
      className="inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <ArrowLeft className="size-3" aria-hidden="true" /> API Routes
    </Link>
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
    <DetailContent detail={detail.data} filters={filters} eyebrow={backLink} />
  );
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

interface DetailContentProps {
  detail: EndpointDetailDto;
  filters: TimeWindowQuery;
  eyebrow: ReactNode;
}

function DetailContent({ detail, filters, eyebrow }: DetailContentProps) {
  const { endpoint, window } = detail;
  const columns = useMemo(() => requestSampleColumns({ showRoute: false }), []);
  const failuresHref = withQuery(PAGES.errors(), {
    ...filterLinkQuery(filters),
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
            <Badge variant="outline">{endpoint.app}</Badge>
            <span>{formatWindowCaption(window)}</span>
          </span>
        }
        actions={
          <Button asChild variant="outline">
            <Link href={failuresHref}>
              <TriangleAlert aria-hidden="true" /> View failures
            </Link>
          </Button>
        }
      />

      <section
        aria-label="Route metrics"
        className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6"
      >
        <KpiCard label="Calls" icon={Activity} value={formatInteger(endpoint.calls)} />
        <KpiCard
          label="Error rate"
          icon={TriangleAlert}
          value={formatPercent(endpoint.errorRate)}
          hint={`${formatInteger(endpoint.errors4xx)} 4xx · ${formatInteger(endpoint.errors5xx)} 5xx`}
        />
        <KpiCard label="p50" icon={Zap} value={formatDuration(endpoint.p50Ms)} />
        <KpiCard label="p95" icon={Gauge} value={formatDuration(endpoint.p95Ms)} />
        <KpiCard label="p99" icon={Hourglass} value={formatDuration(endpoint.p99Ms)} />
        <KpiCard label="Average" icon={Timer} value={formatDuration(endpoint.avgMs)} />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Requests" description="Calls per bucket" className="lg:col-span-2">
          <TrafficChart points={detail.timeseries} grain={window.grain} />
        </Panel>
        <Panel title="Status codes" description="Responses in this window">
          {detail.statusBreakdown.length > 0 ? (
            <StatusBreakdown items={detail.statusBreakdown} />
          ) : (
            <EmptyState title="No responses" />
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Latency" description="p95 per bucket">
          <LatencyChart points={detail.timeseries} grain={window.grain} />
        </Panel>
        <Panel
          title="Errors"
          description="Failed requests by class"
          aside={<ChartLegend series={ERROR_SERIES} />}
        >
          <ErrorsChart points={detail.timeseries} grain={window.grain} />
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
