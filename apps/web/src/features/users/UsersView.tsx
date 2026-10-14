'use client';

import type { TimeWindowQuery, UserSummaryDto } from '@nexus/shared';
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
import { useUserSearch } from './useUserSearch';

const SEARCH_DEBOUNCE_MS = 300;
/** Rows per "Load more". */
const PAGE_SIZE = 50;

/**
 * The table columns. Each user opens its profile through the OPAQUE userKey (PAGES); each app
 * chip opens that app's page — so "who uses which app" is one click either way.
 */
export function userColumns(filters: TimeWindowQuery): DataTableColumn<UserSummaryDto>[] {
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
      align: 'right',
      cell: (row) => formatInteger(row.requests),
    },
    {
      id: 'pageViews',
      header: 'Page views',
      align: 'right',
      cell: (row) => formatInteger(row.pageViews),
    },
    {
      id: 'sessions',
      header: 'Sessions',
      align: 'right',
      cell: (row) => formatInteger(row.sessions),
    },
    {
      id: 'lastSeen',
      header: 'Last seen',
      align: 'right',
      className: 'whitespace-nowrap text-muted-foreground',
      cell: (row) => <RelativeTime iso={row.lastSeenAt} />,
    },
  ];
}

/**
 * The Users page: every VERIFIED identity (SSO cookie or app-attested) active in the window, most
 * recently seen first, with the apps each one uses. Browser-claimed emails are never users — they
 * appear, flagged, on sessions. The email search is sent in a POST body and kept in React state
 * only: an email never lands in the URL, the browser history or an access log (ADR 0006).
 */
export function UsersView() {
  const { filters } = useGlobalFilters();
  const [draft, setDraft] = useState('');
  const search = useDebouncedValue(draft, SEARCH_DEBOUNCE_MS).trim();
  const searching = search !== '';

  const listed = useUserList({ ...filters, limit: PAGE_SIZE }, { enabled: !searching });
  const found = useUserSearch({ ...filters, search, limit: PAGE_SIZE }, { enabled: searching });
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
