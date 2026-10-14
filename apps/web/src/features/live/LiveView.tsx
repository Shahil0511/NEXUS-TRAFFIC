'use client';

import { LIVE_SNAPSHOT_MINUTES, LIVE_TICK_MS, type LiveEventDto } from '@nexus/shared';
import { Activity, Gauge, Pause, Play, Radio, TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';

import { ActivityEventSummary, ActivityKindBadge } from '@/components/ActivityEvent';
import { UserLink } from '@/components/ActorCell';
import { AppChip } from '@/components/AppChip';
import { TrafficChart } from '@/components/charts/TrafficChart';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { KpiCard } from '@/components/KpiCard';
import { PageHeader } from '@/components/PageHeader';
import { ChartSkeleton, Panel } from '@/components/Panel';
import { QueryState } from '@/components/QueryState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { formatDateTime, formatDuration, formatInteger } from '@/lib/format';
import { cn } from '@/lib/utils';

import { latestTick, LIVE_FEED_BUFFER, ticksToPoints } from './liveBuffer';
import { useLiveFeed, type LiveStatus } from './useLiveFeed';

const TICK_SECONDS = LIVE_TICK_MS / 1000;

/**
 * The Live page: tiles for the current minute, the last hour per minute, and a streaming table of
 * API calls and page / tool events as they are committed.
 *
 * WHY THIS SHAPE: the REST snapshot paints the page immediately from the database; the socket then
 * keeps it moving (useLiveFeed). Only the APP filter applies — the time range of the top bar does
 * not: Live is always "now". Pausing freezes the table (new rows are held and counted) while the
 * tiles and the chart keep updating, so reading a row never means losing the pulse.
 */
export function LiveView() {
  const { filters } = useGlobalFilters();
  const live = useLiveFeed({ app: filters.app });
  const columns = useMemo(() => liveColumns({ app: filters.app }), [filters.app]);
  const ticks = live.snapshot.data?.ticks ?? [];
  const current = latestTick(ticks);
  const loading = live.snapshot.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live"
        description={`${filters.app ? `App ${filters.app}` : 'All apps'} · updates every ${TICK_SECONDS} s`}
        actions={<LiveStatusBadge status={live.status} />}
      />

      <section aria-label="Live metrics" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Requests / min"
          icon={Activity}
          loading={loading}
          value={formatInteger(current?.requests)}
          hint="this minute so far"
        />
        <KpiCard
          label="Errors / min"
          icon={TriangleAlert}
          loading={loading}
          value={formatInteger(current ? current.errors4xx + current.errors5xx : undefined)}
          hint={
            current
              ? `${formatInteger(current.errors5xx)} server · ${formatInteger(current.errors4xx)} client`
              : undefined
          }
        />
        <KpiCard
          label="p95 latency"
          icon={Gauge}
          loading={loading}
          value={formatDuration(current?.p95Ms)}
          hint="this minute"
        />
        <KpiCard
          label="Active users"
          icon={Radio}
          loading={loading}
          value={formatInteger(current?.activeUsers)}
          hint="last 5 minutes"
        />
      </section>

      <Panel title="Requests per minute" description={`Last ${LIVE_SNAPSHOT_MINUTES} minutes`}>
        <QueryState
          query={live.snapshot}
          skeleton={<ChartSkeleton />}
          errorTitle="Could not load the last hour"
        >
          {() => <TrafficChart points={ticksToPoints(ticks)} grain="minute" />}
        </QueryState>
      </Panel>

      <Panel
        title="Activity stream"
        description={`API calls, page views and tool uses as they arrive · newest ${LIVE_FEED_BUFFER} kept`}
        contentClassName="px-0 pb-0"
        aside={
          <Button
            variant="outline"
            size="sm"
            onClick={live.paused ? live.resume : live.pause}
            aria-pressed={live.paused}
          >
            {live.paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
            {live.paused
              ? `Resume${live.heldCount > 0 ? ` (${formatInteger(live.heldCount)} new)` : ''}`
              : 'Pause'}
          </Button>
        }
      >
        {live.snapshot.isError ? (
          <ErrorState
            error={live.snapshot.error}
            title="Could not load recent activity"
            onRetry={() => void live.snapshot.refetch()}
          />
        ) : (
          <DataTable
            caption="Live activity, newest first"
            columns={columns}
            rows={live.snapshot.isPending ? undefined : live.events}
            rowKey={(row) => row.eventId}
            loading={live.snapshot.isPending}
            empty={
              <EmptyState
                title="Waiting for traffic"
                description="New API calls and page views appear here as soon as they are ingested."
              />
            }
          />
        )}
      </Panel>
    </div>
  );
}

// ─── Connection status ───────────────────────────────────────────────────────

const STATUS_META: Record<
  LiveStatus,
  { label: string; variant: 'success' | 'muted' | 'warning' | 'destructive' }
> = {
  live: { label: 'Live', variant: 'success' },
  connecting: { label: 'Connecting…', variant: 'muted' },
  reconnecting: { label: 'Reconnecting…', variant: 'warning' },
  offline: { label: 'Offline', variant: 'destructive' },
};

/** WHY: whether the numbers are moving must be obvious — a dot AND a word, never colour alone. */
function LiveStatusBadge({ status }: { status: LiveStatus }) {
  const { label, variant } = STATUS_META[status];
  return (
    <Badge variant={variant} role="status" aria-live="polite">
      <span
        aria-hidden="true"
        className={cn(
          'size-1.5 rounded-full bg-current',
          status === 'live' && 'motion-safe:animate-pulse',
        )}
      />
      {label}
    </Badge>
  );
}

// ─── Streaming table ─────────────────────────────────────────────────────────

/** "Mumbai, IN" from the approximate geo, or null. */
function placeOf(event: LiveEventDto): string | null {
  const parts = [event.city, event.country].filter((part): part is string => !!part);
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * WHO did it — a verified user links to their page through the opaque userKey. The IP appears
 * ONLY when the API sent one (admin sockets; viewer payloads carry none). Other ingested values
 * are rendered as text, never as links.
 */
function LiveActorCell({ event, linkQuery }: { event: LiveEventDto; linkQuery: LinkQuery }) {
  const secondary = [event.ip, placeOf(event)].filter((part): part is string => !!part).join(' · ');
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {event.userEmail && event.userKey ? (
        <UserLink userKey={event.userKey} email={event.userEmail} linkQuery={linkQuery} />
      ) : event.userEmail ? (
        <span className="truncate">{event.userEmail}</span>
      ) : (
        <span className="text-muted-foreground italic">anonymous</span>
      )}
      {secondary ? (
        <span className="truncate font-mono text-2xs text-muted-foreground">{secondary}</span>
      ) : null}
    </div>
  );
}

type LinkQuery = Readonly<Record<string, string | undefined>>;

/** The stream's columns; links carry `linkQuery` (the app filter — Live has no range). */
function liveColumns(linkQuery: LinkQuery): DataTableColumn<LiveEventDto>[] {
  return [
    {
      id: 'time',
      header: 'Time',
      cell: (event) => (
        <span className="text-xs text-muted-foreground tabular">
          {formatDateTime(event.occurredAt)}
        </span>
      ),
      className: 'w-36',
    },
    {
      id: 'app',
      header: 'App',
      cell: (event) => <AppChip app={event.app} linkQuery={linkQuery} />,
      className: 'w-32',
    },
    {
      id: 'kind',
      header: 'Kind',
      cell: (event) => <ActivityKindBadge kind={event.kind} />,
      className: 'w-28',
    },
    {
      id: 'event',
      header: 'Event',
      cell: (event) => (
        <ActivityEventSummary
          event={{ ...event, visibleMs: null, name: null }}
          linkQuery={linkQuery}
        />
      ),
      className: 'max-w-md',
    },
    {
      id: 'actor',
      header: 'User',
      cell: (event) => <LiveActorCell event={event} linkQuery={linkQuery} />,
      className: 'max-w-64',
    },
  ];
}
