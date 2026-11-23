'use client';

import { PERSON_ACCESS_COALESCE_MS } from '@nexus/shared';
import { Eye, X } from 'lucide-react';
import { useMemo } from 'react';

import { AdminOnly } from '@/components/AdminOnly';
import { DataTable } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadMoreButton } from '@/components/LoadMoreButton';
import { PageHeader } from '@/components/PageHeader';
import { ListSkeleton, Panel } from '@/components/Panel';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useMe } from '@/features/me/useMe';

import { accessLogColumns } from './accessLogColumns';
import { useAccessLogParams } from './accessLogParams';
import { useAccessLog } from './useAccessLog';

const TITLE = 'Privacy & access';
/** Rows per "Load more". */
const ACCESS_LOG_PAGE_SIZE = 50;
const COALESCE_MINUTES = Math.round(PERSON_ACCESS_COALESCE_MS / 60_000);

/**
 * What the dashboard records, in plain words. WHY a fixed list: it describes the columns the
 * collectors store (ingest contract), not data about anyone.
 */
export const RECORDED_ITEMS: readonly { title: string; detail: string }[] = [
  {
    title: 'Pages and buttons used',
    detail: 'Which page of an app was opened, and which features (buttons, exports) were used.',
  },
  {
    title: 'Server requests',
    detail: 'Which request type an app answered, when, how long it took and whether it failed.',
  },
  {
    title: 'Browser, system and device type',
    detail: 'For example Chrome on Windows, desktop or phone (read from the browser).',
  },
  {
    title: 'Time zone and language',
    detail: 'As set in the browser, for example Asia/Kolkata and en-IN.',
  },
  { title: 'App version', detail: 'The release of the app that sent the data.' },
  {
    title: 'Tab-visible time',
    detail: 'How long a page was open and visible on screen (not time spent in other tabs).',
  },
];

/**
 * The Privacy & access page (admins only): the person access log — which admin opened which part
 * of whose person page, and when (newest first, "Load more", optionally one person) — and a short
 * list of what the dashboard records. Non-admins see the AdminOnly state; the API enforces the
 * same rule (requireAdmin on ROUTES.privacy.accessLog).
 */
export function PrivacyView() {
  const me = useMe();

  if (me.isPending) {
    return (
      <div className="space-y-6" aria-busy="true">
        <PageHeader title={TITLE} />
        <Card>
          <ListSkeleton rows={6} />
        </Card>
      </div>
    );
  }
  if (me.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title={TITLE} />
        <Card>
          <ErrorState error={me.error} onRetry={() => void me.refetch()} />
        </Card>
      </div>
    );
  }
  if (!me.data.isAdmin) {
    return (
      <AdminOnly
        title={TITLE}
        description="The access log shows which admin opened whose person page, so only dashboard admins can see it."
        hint={null}
      />
    );
  }
  return <PrivacyAdmin />;
}

function PrivacyAdmin() {
  const { userKey, showPerson, showEveryone } = useAccessLogParams();
  const log = useAccessLog({ limit: ACCESS_LOG_PAGE_SIZE, userKey });
  const rows = useMemo(() => log.data?.pages.flatMap((page) => page.items), [log.data]);
  const columns = useMemo(
    () => accessLogColumns(showPerson, userKey !== undefined),
    [showPerson, userKey],
  );
  const personLabel = userKey ? rows?.[0]?.subjectEmailMasked : undefined;

  return (
    <div className="space-y-6">
      <PageHeader title={TITLE} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] xl:items-start">
        <Panel
          title="Who opened a person's page"
          description={`Newest first. A part is a tab of the person page, or the Visits or Failed requests list narrowed to that person. The same admin, person and part is recorded at most once every ${COALESCE_MINUTES} minutes; pages left open do not add entries on their own.`}
          contentClassName="px-0 pb-0"
          aside={
            userKey ? (
              <Button variant="outline" size="sm" onClick={showEveryone}>
                <X aria-hidden="true" /> Only {personLabel ?? 'one person'} · show everyone
              </Button>
            ) : undefined
          }
        >
          {log.isError ? (
            <ErrorState error={log.error} onRetry={() => void log.refetch()} />
          ) : (
            <>
              <DataTable
                caption="Person page access log"
                columns={columns}
                rows={rows}
                rowKey={(row) => String(row.id)}
                loading={log.isPending}
                empty={
                  <EmptyState
                    icon={Eye}
                    title={
                      userKey
                        ? "Nobody has opened this person's page yet"
                        : 'No person page has been opened yet'
                    }
                    description="Each time an admin opens a part of a person's page, or a list narrowed to one person, it is listed here."
                  />
                }
              />
              {rows && rows.length > 0 ? (
                <LoadMoreButton
                  shown={rows.length}
                  hasMore={log.hasNextPage}
                  loading={log.isFetchingNextPage}
                  onLoadMore={() => void log.fetchNextPage()}
                />
              ) : null}
            </>
          )}
        </Panel>

        <Panel
          title="What this dashboard records"
          description="From the apps that send data to it."
        >
          <ul aria-label="What this dashboard records" className="space-y-3">
            {RECORDED_ITEMS.map((item) => (
              <li key={item.title} className="space-y-0.5">
                <p className="text-sm font-medium">{item.title}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">{item.detail}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
