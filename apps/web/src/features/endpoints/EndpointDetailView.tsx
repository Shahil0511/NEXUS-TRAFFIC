'use client';

import type { EndpointDetailDto } from '@nexus/shared';
import { Activity, Gauge, Hourglass, TriangleAlert, Waypoints } from 'lucide-react';
import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';

import { AdminsOnlyNote, REQUESTS_ADMINS_ONLY } from '@/components/AdminsOnlyNote';
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
import { FactSheet, type Fact } from '@/components/FactSheet';
import { HeadlineSentence } from '@/components/HeadlineSentence';
import { MethodBadge } from '@/components/MethodBadge';
import { PageHeader } from '@/components/PageHeader';
import { ChartSkeleton, ListSkeleton, Panel } from '@/components/Panel';
import { ReportSheet, ReportSubsection } from '@/components/ReportSheet';
import { requestSampleColumns } from '@/components/requestSampleColumns';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { WhoUsesIt } from '@/components/WhoUsesIt';
import { filterLinkQuery, useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { formatDuration, formatInteger, formatWindowCaption, perGrain } from '@/lib/format';
import { METRIC_COPY, metricInfo } from '@/lib/metricCopy';
import { PAGES, withQuery } from '@/lib/pages';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

import { endpointHeadline, failedCallsOf, formatFailedShare } from './endpointHeadline';
import { useEndpointDetail } from './useEndpointDetail';

/**
 * One API route as a report sheet (components/ReportSheet): a sentence with its calls, failures
 * and speed, a facts strip, API calls over time, its status codes beside who uses it, and a
 * "Speed and failures" row (latency | errors), the row that sets it apart from the page and
 * feature sheets. The slowest calls follow the sheet. Names and single requests are for admins
 * only (the API sends topUsers / slowest null to everyone else, ADR 0019). Reached ONLY through
 * PAGES.endpointDetail(endpointId) — the opaque id, never the template.
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
        { label: 'Request types', href: withQuery(PAGES.endpoints(), linkQuery) },
        { label: endpoint ? `${endpoint.method} ${endpoint.routeTemplate}` : 'Request type' },
      ]}
    />
  );

  if (detail.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Request type" eyebrow={backLink} />
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

/** The sheet's shape while loading: header, sentence, facts line, chart and two columns. */
function DetailSkeleton({ eyebrow }: { eyebrow: ReactNode }) {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        {eyebrow}
        <Skeleton className="h-7 w-80 max-w-full" />
        <Skeleton className="h-6 w-full max-w-2xl" />
      </div>
      <Skeleton className="h-11 w-full" />
      <ChartSkeleton />
      <div className="grid gap-4 lg:grid-cols-2">
        <ListSkeleton />
        <ListSkeleton />
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

/** The six numbers of the route with their definitions (the old KPI cards, as one strip). */
function endpointFacts(detail: EndpointDetailDto): Fact[] {
  const { endpoint } = detail;
  return [
    {
      label: METRIC_COPY.requests.label,
      value: formatInteger(endpoint.calls),
      info: metricInfo('requests'),
    },
    {
      label: METRIC_COPY.errorRate.label,
      value: formatFailedShare(endpoint),
      note: `${formatInteger(endpoint.errors4xx)} 4xx · ${formatInteger(endpoint.errors5xx)} 5xx`,
      info: metricInfo('errorRate'),
    },
    {
      label: 'People',
      value: formatInteger(detail.uniqueUsers),
      note: 'verified callers',
      info: metricInfo('uniqueUsers'),
    },
    {
      label: 'p50',
      value: endpoint.p50Ms === null ? null : formatDuration(endpoint.p50Ms),
      note: `avg ${formatDuration(endpoint.avgMs)}`,
      info: metricInfo('p50'),
    },
    {
      label: 'p95',
      value: endpoint.p95Ms === null ? null : formatDuration(endpoint.p95Ms),
      info: metricInfo('p95'),
    },
    {
      label: 'p99',
      value: endpoint.p99Ms === null ? null : formatDuration(endpoint.p99Ms),
      info: metricInfo('p99'),
    },
  ];
}

function DetailContent({ detail, linkQuery, eyebrow }: DetailContentProps) {
  const { endpoint, window } = detail;
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
        headline={<HeadlineSentence parts={endpointHeadline(endpoint, detail.uniqueUsers)} />}
        actions={
          failedCallsOf(endpoint) > 0 ? (
            <Button asChild variant="outline">
              <Link href={failuresHref}>
                <TriangleAlert aria-hidden="true" /> View failures
              </Link>
            </Button>
          ) : null
        }
      />

      <ReportSheet
        headlineFacts={<FactSheet ariaLabel="Request type facts" facts={endpointFacts(detail)} />}
        chart={{
          title: `${METRIC_COPY.requests.label} over time`,
          icon: Activity,
          description: `${METRIC_COPY.requests.label} ${perGrain(window.grain)}`,
          content: <TrafficChart points={detail.timeseries} grain={window.grain} />,
        }}
        around={{
          title: 'What happens around it',
          icon: Waypoints,
          description: 'How the route answered',
          content: (
            <ReportSubsection title="Status codes" description="Responses in this window">
              {detail.statusBreakdown.length > 0 ? (
                <StatusBreakdown items={detail.statusBreakdown} />
              ) : (
                <EmptyState className="py-6" title="No responses" />
              )}
            </ReportSubsection>
          ),
        }}
        // Names for admins only; everyone reads the count (ADR 0019).
        who={
          <WhoUsesIt
            count={detail.uniqueUsers}
            users={detail.topUsers}
            unit="calls"
            ariaLabel="Who calls this request type"
            linkQuery={linkQuery}
            emptyTitle="No verified caller"
          />
        }
        second={{
          title: 'Speed and failures',
          icon: Gauge,
          description: 'How fast it answers and how often it fails',
          content: <SpeedAndFailures detail={detail} />,
        }}
        after={<SlowestCalls detail={detail} linkQuery={linkQuery} />}
      />
    </div>
  );
}

/** Latency | Errors, side by side from lg (each under its own h3). */
function SpeedAndFailures({ detail }: { detail: EndpointDetailDto }) {
  const { endpoint, window } = detail;
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-2">
      <ReportSubsection
        title="Latency"
        description={`${METRIC_COPY.p95.label} ${perGrain(window.grain)}`}
      >
        <LatencyChart points={detail.timeseries} grain={window.grain} />
      </ReportSubsection>
      <ReportSubsection title="Errors" description="Failed requests by class">
        {failedCallsOf(endpoint) > 0 ? (
          <div className="min-w-0 space-y-3">
            <ChartLegend series={ERROR_SERIES} />
            <ErrorsChart points={detail.timeseries} grain={window.grain} />
          </div>
        ) : (
          <EmptyState
            className="py-6"
            title="No failures"
            description="Every call in this window succeeded."
          />
        )}
      </ReportSubsection>
    </div>
  );
}

/** The longest single requests: a table for admins, the lock note for everyone else. */
function SlowestCalls({ detail, linkQuery }: { detail: EndpointDetailDto; linkQuery: LinkQuery }) {
  const columns = useMemo(() => requestSampleColumns({ showRoute: false, linkQuery }), [linkQuery]);
  return (
    <Panel
      title="Slowest calls"
      icon={Hourglass}
      description="The longest requests in this window"
      className="min-w-0"
      contentClassName={detail.slowest === null ? undefined : 'px-0 pb-0'}
    >
      {/* Single requests carry a person: admins only, the API sends null to others (ADR 0019). */}
      {detail.slowest === null ? (
        <AdminsOnlyNote>{REQUESTS_ADMINS_ONLY}</AdminsOnlyNote>
      ) : (
        <DataTable
          caption="Slowest calls"
          columns={columns}
          rows={detail.slowest}
          rowKey={(row) => row.eventId}
          empty={<EmptyState title="No calls recorded" />}
        />
      )}
    </Panel>
  );
}
