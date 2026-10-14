'use client';

import type { TimeWindowQuery, UserProfileDto } from '@nexus/shared';
import { Activity, ArrowLeft, Eye, TriangleAlert, Waypoints } from 'lucide-react';
import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';

import { AppChip, AppChipList } from '@/components/AppChip';
import { DataTable } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { KpiCard } from '@/components/KpiCard';
import { LoadMoreButton } from '@/components/LoadMoreButton';
import { MethodBadge } from '@/components/MethodBadge';
import { PageHeader } from '@/components/PageHeader';
import { ListSkeleton, Panel } from '@/components/Panel';
import { RankedList } from '@/components/RankedList';
import { RelativeTime } from '@/components/RelativeTime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { filterLinkQuery, useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { formatCountry, formatDateTime, formatInteger, formatPercent } from '@/lib/format';
import { PAGES, withQuery } from '@/lib/pages';
import { maskEmail, useDocumentTitle } from '@/lib/useDocumentTitle';

import { userTimelineColumns } from './userTimelineColumns';
import { useUserProfile } from './useUserProfile';
import { useUserTimeline } from './useUserTimeline';

/** Timeline rows per "Load more". */
const TIMELINE_PAGE_SIZE = 50;
const PERCENT = 100;
const PROFILE_PANELS = ['Top pages', 'Top tools', 'Countries'] as const;
/** Inline link inside a ranked list row. */
const ROW_LINK =
  'rounded-sm outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/60';

/**
 * One verified user: totals, the pages and tools they use most, where they connect from, and a
 * combined timeline of API calls, page views and tool uses. Reached ONLY through
 * PAGES.userDetail(userKey) — the opaque HMAC, never the email.
 */
export function UserDetailView({ userKey }: { userKey: string }) {
  const { filters } = useGlobalFilters();
  const profile = useUserProfile(userKey, filters);
  const backLink = (
    <Link
      href={withQuery(PAGES.users(), filterLinkQuery(filters))}
      className="inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <ArrowLeft className="size-3" aria-hidden="true" /> Users
    </Link>
  );

  if (profile.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="User" eyebrow={backLink} />
        <Card>
          <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />
        </Card>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {profile.isPending ? (
        <ProfileSkeleton eyebrow={backLink} />
      ) : (
        <ProfileContent
          userKey={userKey}
          profile={profile.data}
          filters={filters}
          eyebrow={backLink}
        />
      )}
      <TimelinePanel userKey={userKey} filters={filters} />
    </div>
  );
}

function ProfileSkeleton({ eyebrow }: { eyebrow: ReactNode }) {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">{eyebrow}</div>
        <Skeleton className="h-7 w-72" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <KpiCard key={index} label="" value="" loading />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {PROFILE_PANELS.map((title) => (
          <Panel key={title} title={title}>
            <ListSkeleton rows={4} />
          </Panel>
        ))}
      </div>
    </div>
  );
}

interface ProfileContentProps {
  userKey: string;
  profile: UserProfileDto;
  filters: TimeWindowQuery;
  eyebrow: ReactNode;
}

function ProfileContent({ userKey, profile, filters, eyebrow }: ProfileContentProps) {
  const { summary } = profile;
  const linkQuery = filterLinkQuery(filters);
  const sessionsHref = withQuery(PAGES.journeys(), { ...linkQuery, userKey });
  const failuresHref = withQuery(PAGES.errors(), { ...linkQuery, userKey });
  useDocumentTitle(maskEmail(summary.email));
  const failedShare =
    summary.requests > 0 ? (profile.failedRequests / summary.requests) * PERCENT : null;
  return (
    <>
      <PageHeader
        eyebrow={eyebrow}
        title={summary.email}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <AppChipList apps={summary.apps} linkQuery={linkQuery} max={6} />
            <span>
              First seen in this range {formatDateTime(profile.firstSeenAt)} · last seen{' '}
              {formatDateTime(summary.lastSeenAt)} IST
            </span>
          </span>
        }
        actions={
          <>
            {profile.failedRequests > 0 ? (
              <Button asChild variant="outline">
                <Link href={failuresHref}>
                  <TriangleAlert aria-hidden="true" /> View failures
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="outline">
              <Link href={sessionsHref}>
                <Waypoints aria-hidden="true" /> View sessions
              </Link>
            </Button>
          </>
        }
      />

      <section aria-label="User metrics" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="API requests" icon={Activity} value={formatInteger(summary.requests)} />
        <KpiCard
          label="Failed requests"
          icon={TriangleAlert}
          value={formatInteger(profile.failedRequests)}
          hint={failedShare !== null ? `${formatPercent(failedShare)} of requests` : undefined}
          href={profile.failedRequests > 0 ? failuresHref : undefined}
        />
        <KpiCard label="Page views" icon={Eye} value={formatInteger(summary.pageViews)} />
        <KpiCard
          label="Sessions"
          icon={Waypoints}
          value={formatInteger(summary.sessions)}
          hint="browser sessions"
          href={summary.sessions > 0 ? sessionsHref : undefined}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Apps used" description="This user's activity per application">
          <AppsUsedTable apps={profile.perApp} linkQuery={linkQuery} />
        </Panel>
        <Panel title="Top API routes" description="The routes this user calls most">
          {profile.topEndpoints.length > 0 ? (
            <RankedList
              ariaLabel="Top API routes"
              items={profile.topEndpoints.map((route) => ({
                key: route.endpointId,
                label: (
                  <Link
                    href={withQuery(PAGES.endpointDetail(route.endpointId), linkQuery)}
                    className={`inline-flex min-w-0 items-center gap-1.5 ${ROW_LINK}`}
                  >
                    <MethodBadge method={route.method} />
                    <span className="truncate font-mono">{route.routeTemplate}</span>
                  </Link>
                ),
                sublabel: (
                  <span className="inline-flex items-center gap-1.5">
                    <AppChip app={route.app} linkQuery={linkQuery} />
                    {route.failed > 0 ? (
                      <span className="text-destructive">{formatInteger(route.failed)} failed</span>
                    ) : null}
                  </span>
                ),
                value: route.calls,
              }))}
            />
          ) : (
            <EmptyState title="No API calls" description="This user only used the browser UI." />
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Top pages" description="Most viewed page templates">
          {profile.topPages.length > 0 ? (
            <RankedList
              ariaLabel="Top pages"
              items={profile.topPages.map((page) => ({
                key: page.pageId,
                label: (
                  <Link
                    href={withQuery(PAGES.pageDetail(page.app, page.pageId), linkQuery)}
                    className={`font-mono ${ROW_LINK}`}
                  >
                    {page.pathTemplate}
                  </Link>
                ),
                sublabel: <AppChip app={page.app} linkQuery={linkQuery} />,
                value: page.views,
              }))}
            />
          ) : (
            <EmptyState title="No page views" description="This user only called APIs." />
          )}
        </Panel>
        <Panel title="Top tools" description="UI tools and features used">
          {profile.topTools.length > 0 ? (
            <RankedList
              ariaLabel="Top tools"
              items={profile.topTools.map((tool) => ({
                key: tool.toolId,
                label: (
                  <Link
                    href={withQuery(PAGES.toolDetail(tool.app, tool.toolId), linkQuery)}
                    className={ROW_LINK}
                  >
                    {tool.tool}
                  </Link>
                ),
                sublabel: <AppChip app={tool.app} linkQuery={linkQuery} />,
                value: tool.uses,
              }))}
            />
          ) : (
            <EmptyState title="No tool uses" description="No tracked tool was used." />
          )}
        </Panel>
        <Panel title="Countries" description="Where this user connected from (approximate)">
          {profile.countries.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5" aria-label="Countries">
              {profile.countries.map((country) => (
                <li key={country}>
                  <Badge variant="muted" title={country}>
                    {formatCountry(country)}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No location" description="Private or unknown IP addresses only." />
          )}
        </Panel>
      </div>
    </>
  );
}

// ─── Apps used ───────────────────────────────────────────────────────────────

/** WHY: "which apps does this person use, and how much" — one row per app, each opening it. */
function AppsUsedTable({
  apps,
  linkQuery,
}: {
  apps: UserProfileDto['perApp'];
  linkQuery: Record<string, string | undefined>;
}) {
  if (apps.length === 0) return <EmptyState title="No activity" />;
  return (
    <table className="w-full text-xs">
      <caption className="sr-only">Apps used</caption>
      <thead>
        <tr className="text-[11px] text-muted-foreground uppercase">
          <th scope="col" className="pb-2 text-left font-medium">
            App
          </th>
          <th scope="col" className="pb-2 text-right font-medium">
            API calls
          </th>
          <th scope="col" className="pb-2 text-right font-medium">
            Page views
          </th>
          <th scope="col" className="pb-2 text-right font-medium">
            Tools
          </th>
          <th scope="col" className="pb-2 text-right font-medium">
            Last seen
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {apps.map((app) => (
          <tr key={app.app}>
            <td className="py-2">
              <AppChip app={app.app} linkQuery={linkQuery} />
            </td>
            <td className="py-2 text-right tabular">{formatInteger(app.requests)}</td>
            <td className="py-2 text-right tabular">{formatInteger(app.pageViews)}</td>
            <td className="py-2 text-right tabular">{formatInteger(app.toolUses)}</td>
            <td className="py-2 text-right text-muted-foreground">
              <RelativeTime iso={app.lastSeenAt} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Timeline ────────────────────────────────────────────────────────────────

function TimelinePanel({ userKey, filters }: { userKey: string; filters: TimeWindowQuery }) {
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
            empty={<EmptyState title="No activity in this window" />}
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
