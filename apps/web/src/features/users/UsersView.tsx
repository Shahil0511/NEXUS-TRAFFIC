'use client';

import type { TimeWindowQuery, UserSummaryDto } from '@nexus/shared';
import { Search, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadMoreButton } from '@/components/LoadMoreButton';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { filterLinkQuery, useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { formatDateTime, formatInteger } from '@/lib/format';
import { PAGES, withQuery } from '@/lib/pages';
import { useDebouncedValue } from '@/lib/useDebouncedValue';

import { useUserList } from './useUserList';
import { useUserListParams } from './useUserListParams';

const SEARCH_DEBOUNCE_MS = 300;
/** Rows per "Load more". */
const PAGE_SIZE = 50;

/** The table columns; each user opens its profile through the OPAQUE userKey (PAGES). */
export function userColumns(filters: TimeWindowQuery): DataTableColumn<UserSummaryDto>[] {
  const linkQuery = filterLinkQuery(filters);
  return [
    {
      id: 'user',
      header: 'User',
      className: 'w-full max-w-0',
      cell: (row) => (
        <Link
          href={withQuery(PAGES.userDetail(row.userKey), linkQuery)}
          className="flex min-w-0 items-center gap-2.5 rounded-sm outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-foreground uppercase"
          >
            {row.email.slice(0, 2)}
          </span>
          <span className="min-w-0">
            <span className="block truncate">{row.email}</span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {row.apps.join(' · ')}
            </span>
          </span>
        </Link>
      ),
    },
    {
      id: 'requests',
      header: 'Requests',
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
      className: 'text-muted-foreground',
      cell: (row) => <time dateTime={row.lastSeenAt}>{formatDateTime(row.lastSeenAt)}</time>,
    },
  ];
}

/**
 * The Users page: every VERIFIED identity (SSO cookie or app-attested) active in the window, most
 * recently seen first. Browser-claimed emails are never users — they appear, flagged, on sessions.
 * Search is debounced into the URL; pages load on demand.
 */
export function UsersView() {
  const { filters } = useGlobalFilters();
  const { search, setSearch } = useUserListParams();
  const [draft, setDraft] = useState(search);
  const settled = useDebouncedValue(draft, SEARCH_DEBOUNCE_MS);

  // Push ONLY when the typed value settles — a URL change from elsewhere (back button) must not
  // be overwritten by a stale draft.
  const searchRef = useRef(search);
  searchRef.current = search;
  useEffect(() => {
    if (settled !== searchRef.current) setSearch(settled);
  }, [settled, setSearch]);

  const query = useUserList({
    ...filters,
    search: search === '' ? undefined : search,
    limit: PAGE_SIZE,
  });
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
          <label className="relative block w-72">
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
            />
          </label>
        }
      />
      <Card className="overflow-hidden">
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
                    search ? 'No user matches your search' : 'No identified users in this window'
                  }
                  description={
                    search
                      ? 'Search matches the email address, e.g. buyer@libas.in.'
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
