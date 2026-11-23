'use client';

import type { TimeWindowQuery } from '@nexus/shared';
import { useMemo } from 'react';

import { DataTable } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadMoreButton } from '@/components/LoadMoreButton';
import { Panel } from '@/components/Panel';
import { WidenRangeButton } from '@/components/WidenRangeButton';

import { userTimelineColumns } from './userTimelineColumns';
import { useUserTimeline } from './useUserTimeline';

/** Timeline rows per "Load more". */
const TIMELINE_PAGE_SIZE = 50;

/**
 * WHY: "what exactly happened, and when?" — the person's API calls, page views and tool uses
 * merged newest first, keyset-paged with "Load more".
 */
export function UserActivityTab({
  userKey,
  filters,
}: {
  userKey: string;
  filters: TimeWindowQuery;
}) {
  const timeline = useUserTimeline(userKey, { ...filters, limit: TIMELINE_PAGE_SIZE });
  const rows = useMemo(() => timeline.data?.pages.flatMap((page) => page.items), [timeline.data]);
  const columns = useMemo(() => userTimelineColumns(filters), [filters]);
  return (
    <Panel
      title="Activity"
      description="API calls, page views and tool uses, newest first"
      contentClassName="px-0 pb-0"
    >
      {timeline.isError ? (
        <ErrorState error={timeline.error} onRetry={() => void timeline.refetch()} />
      ) : (
        <>
          <DataTable
            caption="User activity"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.eventId}
            loading={timeline.isPending}
            empty={<EmptyState title="No activity in this window" action={<WidenRangeButton />} />}
          />
          {rows && rows.length > 0 ? (
            <LoadMoreButton
              shown={rows.length}
              hasMore={timeline.hasNextPage}
              loading={timeline.isFetchingNextPage}
              onLoadMore={() => void timeline.fetchNextPage()}
            />
          ) : null}
        </>
      )}
    </Panel>
  );
}
