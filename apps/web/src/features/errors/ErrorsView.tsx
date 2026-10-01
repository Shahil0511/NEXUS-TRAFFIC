'use client';

import { STATUS_CLASS_VALUES, type StatusClass } from '@nexus/shared';
import { Ban, ServerCrash, TriangleAlert, X } from 'lucide-react';
import { useMemo } from 'react';

import { ChartLegend } from '@/components/charts/ChartLegend';
import { ERROR_SERIES, ErrorsChart } from '@/components/charts/ErrorsChart';
import { StatusBreakdown } from '@/components/charts/StatusBreakdown';
import { DataTable } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { KpiCard } from '@/components/KpiCard';
import { LoadMoreButton } from '@/components/LoadMoreButton';
import { PageHeader } from '@/components/PageHeader';
import { ChartSkeleton, ListSkeleton, Panel } from '@/components/Panel';
import { QueryState } from '@/components/QueryState';
import { requestSampleColumns } from '@/components/requestSampleColumns';
import { Button } from '@/components/ui/button';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/segmented-control';
import { useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { formatInteger, formatWindowCaption } from '@/lib/format';

import { TopFailingEndpoints } from './TopFailingEndpoints';
import { useErrorListParams } from './useErrorListParams';
import { useErrorSummary } from './useErrorSummary';
import { useFailedRequests } from './useFailedRequests';

/** Rows per "Load more". */
const PAGE_SIZE = 50;

const STATUS_CLASS_LABELS: Record<StatusClass, { label: string; ariaLabel: string }> = {
  all: { label: 'All', ariaLabel: 'All failures' },
  '4xx': { label: '4xx', ariaLabel: 'Client errors (4xx)' },
  '5xx': { label: '5xx', ariaLabel: 'Server errors (5xx)' },
};

const STATUS_CLASS_OPTIONS: readonly SegmentedOption<StatusClass>[] = STATUS_CLASS_VALUES.map(
  (value) => ({ value, ...STATUS_CLASS_LABELS[value] }),
);

/**
 * The Errors page: failure totals, 4xx/5xx over time, status codes, the routes that fail most and
 * the newest failed requests (keyset-paged, "Load more"), with the user, geo and — for admins —
 * the IP of each.
 */
export function ErrorsView() {
  const { filters } = useGlobalFilters();
  const summary = useErrorSummary(filters);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Errors"
        description={
          summary.data
            ? formatWindowCaption(summary.data.window)
            : 'Failed API requests (4xx and 5xx)'
        }
      />

      <section aria-label="Failure totals" className="grid grid-cols-3 gap-3">
        <KpiCard
          label="Failed requests"
          icon={TriangleAlert}
          loading={summary.isPending}
          value={formatInteger(summary.data?.total)}
        />
        <KpiCard
          label="Server errors (5xx)"
          icon={ServerCrash}
          loading={summary.isPending}
          value={formatInteger(summary.data?.errors5xx)}
        />
        <KpiCard
          label="Client errors (4xx)"
          icon={Ban}
          loading={summary.isPending}
          value={formatInteger(summary.data?.errors4xx)}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title="Failures over time"
          description="Stacked by status class"
          aside={<ChartLegend series={ERROR_SERIES} />}
          className="lg:col-span-2"
        >
          <QueryState
            query={summary}
            skeleton={<ChartSkeleton />}
            isEmpty={summary.data?.total === 0}
            empty={
              <EmptyState
                title="No failures"
                description="Every request in this window succeeded."
              />
            }
          >
            {() => (
              <ErrorsChart points={summary.data!.timeseries} grain={summary.data!.window.grain} />
            )}
          </QueryState>
        </Panel>
        <div className="flex flex-col gap-4">
          <Panel title="Status codes">
            <QueryState
              query={summary}
              skeleton={<ListSkeleton rows={3} />}
              isEmpty={summary.data?.byStatus.length === 0}
              empty={<EmptyState title="No failed responses" />}
            >
              {() => <StatusBreakdown items={summary.data!.byStatus} />}
            </QueryState>
          </Panel>
          <Panel title="Top failing routes" className="flex-1">
            <QueryState query={summary} skeleton={<ListSkeleton rows={3} />}>
              {() => (
                <TopFailingEndpoints
                  endpoints={summary.data!.topEndpoints}
                  filters={filters}
                  limit={4}
                />
              )}
            </QueryState>
          </Panel>
        </div>
      </div>

      <FailedRequestsPanel />
    </div>
  );
}

// ─── Failed requests ─────────────────────────────────────────────────────────

function FailedRequestsPanel() {
  const { filters } = useGlobalFilters();
  const { statusClass, endpointId, setStatusClass, clearEndpoint } = useErrorListParams();
  const failures = useFailedRequests({ ...filters, statusClass, endpointId, limit: PAGE_SIZE });
  const rows = useMemo(() => failures.data?.pages.flatMap((page) => page.items), [failures.data]);
  const columns = useMemo(() => requestSampleColumns({ showRoute: true }), []);

  return (
    <Panel
      title="Failed requests"
      description="Newest first"
      contentClassName="px-0 pb-0"
      aside={
        <div className="flex items-center gap-2">
          {endpointId ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={clearEndpoint}
              aria-label="Show failures of every route"
            >
              One route only
              <X aria-hidden="true" />
            </Button>
          ) : null}
          <SegmentedControl
            ariaLabel="Status class"
            value={statusClass}
            options={STATUS_CLASS_OPTIONS}
            onValueChange={setStatusClass}
          />
        </div>
      }
    >
      {failures.isError ? (
        <ErrorState error={failures.error} onRetry={() => void failures.refetch()} />
      ) : (
        <>
          <DataTable
            caption="Failed requests"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.eventId}
            loading={failures.isPending}
            empty={
              <EmptyState title="No failed requests" description="Nothing matches these filters." />
            }
          />
          {rows && rows.length > 0 ? (
            <LoadMoreButton
              shown={rows.length}
              hasMore={failures.hasNextPage}
              loading={failures.isFetchingNextPage}
              onLoadMore={() => void failures.fetchNextPage()}
            />
          ) : null}
        </>
      )}
    </Panel>
  );
}
