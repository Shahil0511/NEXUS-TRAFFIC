'use client';

import { X } from 'lucide-react';
import { useMemo } from 'react';

import { DataTable } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadMoreButton } from '@/components/LoadMoreButton';
import { PageHeader } from '@/components/PageHeader';
import { ListSkeleton, Panel } from '@/components/Panel';
import { QueryState } from '@/components/QueryState';
import { Button } from '@/components/ui/button';
import { useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { formatWindowCaption } from '@/lib/format';

import { sessionColumns } from './sessionColumns';
import { TopPathsList } from './TopPathsList';
import { useSessionList } from './useSessionList';
import { useSessionListParams } from './useSessionListParams';
import { useTopPaths } from './useTopPaths';

/** Rows per "Load more". */
const PAGE_SIZE = 50;
/** How many 3-step paths the panel ranks. */
const TOP_PATHS_LIMIT = 8;

/**
 * The Journeys page: the most common 3-page paths and every browser session (most recent first,
 * keyset-paged), each opening its replay. `?userKey=` (from a user's profile) narrows the list to
 * one verified user.
 */
export function JourneysView() {
  const { filters } = useGlobalFilters();
  const topPaths = useTopPaths({ ...filters, limit: TOP_PATHS_LIMIT });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Journeys"
        description={
          topPaths.data
            ? formatWindowCaption(topPaths.data.window)
            : 'Browser sessions, their replays and the paths people take'
        }
      />

      <Panel title="Top paths" description="Most common 3-page sequences (reloads not counted)">
        <QueryState
          query={topPaths}
          skeleton={<ListSkeleton rows={4} />}
          isEmpty={topPaths.data?.items.length === 0}
          empty={
            <EmptyState
              title="No multi-page sessions"
              description="Paths appear once sessions visit at least three pages."
            />
          }
        >
          {() => <TopPathsList paths={topPaths.data!.items} />}
        </QueryState>
      </Panel>

      <SessionsPanel />
    </div>
  );
}

// ─── Sessions ────────────────────────────────────────────────────────────────

function SessionsPanel() {
  const { filters } = useGlobalFilters();
  const { userKey, clearUser } = useSessionListParams();
  const sessions = useSessionList({ ...filters, userKey, limit: PAGE_SIZE });
  const rows = useMemo(() => sessions.data?.pages.flatMap((page) => page.items), [sessions.data]);
  const columns = useMemo(() => sessionColumns(filters), [filters]);
  // The chip names the user from the rows (verified email of their sessions), never from the URL.
  const userLabel =
    (userKey && rows?.find((row) => row.userKey === userKey)?.userEmail) || 'One user only';

  return (
    <Panel
      title="Sessions"
      description="Most recent first · open one to replay it"
      contentClassName="px-0 pb-0"
      aside={
        userKey ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={clearUser}
            className="max-w-72"
            aria-label={`Remove user filter ${userLabel}`}
          >
            <span className="truncate">{userLabel}</span>
            <X aria-hidden="true" />
          </Button>
        ) : null
      }
    >
      {sessions.isError ? (
        <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} />
      ) : (
        <>
          <DataTable
            caption="Sessions"
            columns={columns}
            rows={rows}
            rowKey={(row) => `${row.app}|${row.sessionId}`}
            loading={sessions.isPending}
            empty={
              <EmptyState
                title="No sessions in this window"
                description="Sessions appear once an app sends browser events. Try a longer range."
              />
            }
          />
          {rows && rows.length > 0 ? (
            <LoadMoreButton
              shown={rows.length}
              hasMore={sessions.hasNextPage}
              loading={sessions.isFetchingNextPage}
              onLoadMore={() => void sessions.fetchNextPage()}
            />
          ) : null}
        </>
      )}
    </Panel>
  );
}
