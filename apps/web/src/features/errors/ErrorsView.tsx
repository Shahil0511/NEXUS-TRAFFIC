'use client';

import { STATUS_CLASS_VALUES, type StatusClass } from '@nexus/shared';
import { Ban, ServerCrash, TriangleAlert, UserX, X } from 'lucide-react';
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
import { TopUsersList } from '@/components/TopUsersList';
import { Button } from '@/components/ui/button';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/segmented-control';
import { useEndpointDetail } from '@/features/endpoints/useEndpointDetail';
import { filterLinkQuery, useGlobalFilters } from '@/features/filters/useGlobalFilters';
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
 * The Errors page: failure totals, how many people were hit, 4xx/5xx over time, status codes, the
 * routes that fail most, the users hit most and the newest failed requests (keyset-paged, "Load
 * more"), with the user, geo and — for admins — the IP of each. `?endpointId=` / `?userKey=` scope
 * EVERYTHING on the page to one route / one user.
 */
export function ErrorsView() {
  const { filters } = useGlobalFilters();
  const { endpointId, userKey } = useErrorListParams();
  // Scoped like the list below: every number describes the same requests as the list.
  const summary = useErrorSummary({ ...filters, endpointId, userKey });
  const linkQuery = useMemo(() => filterLinkQuery(filters), [filters]);

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

      <section aria-label="Failure totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
        <KpiCard
          label="Users affected"
          icon={UserX}
          loading={summary.isPending}
          value={formatInteger(summary.data?.usersAffected)}
          hint="verified users with ≥ 1 failure"
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
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Top failing routes" description="Most 4xx + 5xx responses">
          <QueryState query={summary} skeleton={<ListSkeleton />}>
            {() => <TopFailingEndpoints endpoints={summary.data!.topEndpoints} filters={filters} />}
          </QueryState>
        </Panel>
        <Panel title="Most affected users" description="Verified users by failed requests">
          <QueryState query={summary} skeleton={<ListSkeleton />}>
            {() => (
              <TopUsersList
                users={summary.data!.topAffectedUsers}
                unit="failed"
                ariaLabel="Most affected users"
                linkQuery={linkQuery}
                emptyTitle="No verified user was affected"
              />
            )}
          </QueryState>
        </Panel>
      </div>

      <FailedRequestsPanel />
    </div>
  );
}

// ─── Failed requests ─────────────────────────────────────────────────────────

/**
 * WHY: "One route only ×" must say WHICH route — the template comes from the route's own query
 * (keyed by the opaque endpointId; the same cache entry as its page), never from the URL.
 */
function RouteFilterChip({ endpointId, onClear }: { endpointId: string; onClear: () => void }) {
  const { filters } = useGlobalFilters();
  const route = useEndpointDetail(endpointId, filters);
  const label = route.data
    ? `${route.data.endpoint.method} ${route.data.endpoint.routeTemplate}`
    : 'One route only';
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={onClear}
      className="max-w-72"
      aria-label={`Remove route filter ${label}`}
    >
      <span className="truncate font-mono text-xs">{label}</span>
      <X aria-hidden="true" />
    </Button>
  );
}

/**
 * WHY: "User: x ×" names the user from the user-scoped summary (its only affected user) — never
 * from the URL, which carries the opaque key only.
 */
function UserFilterChip({ userKey, onClear }: { userKey: string; onClear: () => void }) {
  const { filters } = useGlobalFilters();
  const summary = useErrorSummary({ ...filters, userKey });
  const email = summary.data?.topAffectedUsers.find((user) => user.userKey === userKey)?.email;
  const label = email ? `User: ${email}` : 'One user only';
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={onClear}
      className="max-w-72"
      aria-label={`Remove user filter ${label}`}
    >
      <span className="truncate">{label}</span>
      <X aria-hidden="true" />
    </Button>
  );
}

function FailedRequestsPanel() {
  const { filters } = useGlobalFilters();
  const { statusClass, endpointId, userKey, setStatusClass, clearEndpoint, clearUser } =
    useErrorListParams();
  const failures = useFailedRequests({
    ...filters,
    statusClass,
    endpointId,
    userKey,
    limit: PAGE_SIZE,
  });
  const rows = useMemo(() => failures.data?.pages.flatMap((page) => page.items), [failures.data]);
  const linkQuery = useMemo(() => filterLinkQuery(filters), [filters]);
  const columns = useMemo(() => requestSampleColumns({ showRoute: true, linkQuery }), [linkQuery]);

  return (
    <Panel
      title="Failed requests"
      description="Newest first"
      contentClassName="px-0 pb-0"
      aside={
        <div className="flex items-center gap-2">
          {endpointId ? <RouteFilterChip endpointId={endpointId} onClear={clearEndpoint} /> : null}
          {userKey ? <UserFilterChip userKey={userKey} onClear={clearUser} /> : null}
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
