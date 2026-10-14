'use client';

import type { TimeWindowQuery, UserSort, UserSummaryDto } from '@nexus/shared';
import { Search, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { AppChipList } from '@/components/AppChip';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadMoreButton } from '@/components/LoadMoreButton';
import { PageHeader } from '@/components/PageHeader';
import { RelativeTime } from '@/components/RelativeTime';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { filterLinkQuery, useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { formatInteger } from '@/lib/format';
import { PAGES, withQuery } from '@/lib/pages';
import { useDebouncedValue } from '@/lib/useDebouncedValue';

import { useUserList } from './useUserList';
import { useUserListParams } from './useUserListParams';
import { useUserSearch } from './useUserSearch';

const SEARCH_DEBOUNCE_MS = 300;
/** Rows per "Load more". */
const PAGE_SIZE = 50;

/**
 * The table columns; `sortKey` values are the API whitelist (USER_SORT_VALUES). Each user opens
 * its profile through the OPAQUE userKey (PAGES); each app chip opens that app's page — so "who
 * uses which app" is one click either way. "Failed" opens the user's failures on Errors.
 */
export function userColumns(filters: TimeWindowQuery): DataTableColumn<UserSummaryDto, UserSort>[] {
  const linkQuery = filterLinkQuery(filters);
  return [
    {
      id: 'user',
      header: 'User',
      className: 'w-full max-w-0',
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-foreground uppercase"
          >
            {row.email.slice(0, 2)}
          </span>
          <span className="min-w-0 space-y-1">
            <Link
              href={withQuery(PAGES.userDetail(row.userKey), linkQuery)}
              className="block truncate rounded-sm outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              {row.email}
            </Link>
            <AppChipList apps={row.apps} linkQuery={linkQuery} />
          </span>
        </span>
      ),
    },
    {
      id: 'requests',
      header: 'API calls',
      sortKey: 'requests',
      align: 'right',
      cell: (row) => formatInteger(row.requests),
    },
    {
      id: 'failed',
      header: 'Failed',
      sortKey: 'failed',
      align: 'right',
      cell: (row) =>
        row.failedRequests > 0 ? (
          <Link
            href={withQuery(PAGES.errors(), { ...linkQuery, userKey: row.userKey })}
            className="rounded-sm font-medium text-destructive underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60"
            aria-label={`${formatInteger(row.failedRequests)} failed requests of ${row.email}`}
          >
            {formatInteger(row.failedRequests)}
          </Link>
        ) : (
          <span className="text-muted-foreground">0</span>
        ),
    },
    {
      id: 'pageViews',
      header: 'Page views',
      sortKey: 'pageViews',
      align: 'right',
      cell: (row) => formatInteger(row.pageViews),
    },
    {
      id: 'sessions',
      header: 'Sessions',
      sortKey: 'sessions',
      align: 'right',
      cell: (row) => formatInteger(row.sessions),
    },
    {
      id: 'firstSeen',
      header: 'First seen',
      sortKey: 'firstSeen',
      align: 'right',
      className: 'whitespace-nowrap text-muted-foreground',
      cell: (row) => <RelativeTime iso={row.firstSeenAt} />,
    },
    {
      id: 'lastSeen',
      header: 'Last seen',
      sortKey: 'lastSeen',
      align: 'right',
      className: 'whitespace-nowrap text-muted-foreground',
      cell: (row) => <RelativeTime iso={row.lastSeenAt} />,
    },
  ];
}

/**
 * The Users page: every VERIFIED identity (SSO cookie or app-attested) active in the window, sorted
 * server-side by any column (`?sort=&dir=`, default most recently seen), with the apps each uses. Browser-claimed emails are never users — they
 * appear, flagged, on sessions. The email search is sent in a POST body and kept in React state
 * only: an email never lands in the URL, the browser history or an access log (ADR 0006).
 */
export function UsersView() {
  const { filters } = useGlobalFilters();
  const { sort, dir, setSort } = useUserListParams();
  const [draft, setDraft] = useState('');
  const search = useDebouncedValue(draft, SEARCH_DEBOUNCE_MS).trim();
  const searching = search !== '';

  const listed = useUserList({ ...filters, sort, dir, limit: PAGE_SIZE }, { enabled: !searching });
  const found = useUserSearch(
    { ...filters, search, sort, dir, limit: PAGE_SIZE },
    { enabled: searching },
  );
  const query = searching ? found : listed;

  const rows = useMemo(() => query.data?.pages.flatMap((page) => page.items), [query.data]);
  const columns = useMemo(() => userColumns(filters), [filters]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description={
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            Verified identities only (SSO or app-attested) — browser claims are never counted
          </span>
        }
        actions={
          <label className="relative block w-full sm:w-72">
            <span className="sr-only">Search users</span>
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Search by email…"
              className="pl-8"
              autoComplete="off"
            />
          </label>
        }
      />
      <Card className="overflow-hidden" aria-busy={query.isFetching}>
        {query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <>
            <DataTable
              caption="Users"
              columns={columns}
              rows={rows}
              rowKey={(row) => row.userKey}
              sort={{ sort, dir }}
              onSortChange={setSort}
              loading={query.isPending}
              empty={
                <EmptyState
                  title={
                    searching ? 'No user matches your search' : 'No identified users in this window'
                  }
                  description={
                    searching
                      ? 'Search matches part of the email address, e.g. buyer@libas.in.'
                      : 'Users appear once an app sends verified identities (SSO cookie or app-attested). Try a longer range.'
                  }
                />
              }
            />
            {rows && rows.length > 0 ? (
              <LoadMoreButton
                shown={rows.length}
                hasMore={query.hasNextPage}
                loading={query.isFetchingNextPage}
                onLoadMore={() => void query.fetchNextPage()}
              />
            ) : null}
          </>
        )}
      </Card>
    </div>
  );
}
