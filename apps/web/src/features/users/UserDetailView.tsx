'use client';

import { type AppDto, ERROR_CODES, type TimeWindowQuery, type UserProfileDto } from '@nexus/shared';
import { Activity, Eye, TriangleAlert, UserX, Waypoints } from 'lucide-react';
import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';

import { AppChip, AppChipList } from '@/components/AppChip';
import { Breadcrumbs } from '@/components/Breadcrumbs';
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
import { WidenRangeButton } from '@/components/WidenRangeButton';
import { useAppList } from '@/features/apps/useAppList';
import { filterLinkQuery, useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { ApiError } from '@/lib/apiError';
import { formatCountry, formatDateTime, formatInteger, formatPercent } from '@/lib/format';
import { metricInfo } from '@/lib/metricCopy';
import { PAGES, withQuery } from '@/lib/pages';
import { maskEmail, useDocumentTitle } from '@/lib/useDocumentTitle';

import { OnlineBadge } from './OnlineBadge';
import { userTimelineColumns } from './userTimelineColumns';
import { useUserProfile } from './useUserProfile';
import { useUserTimeline } from './useUserTimeline';

/** Timeline rows per "Load more". */
const TIMELINE_PAGE_SIZE = 50;
const PERCENT = 100;
const HTTP_NOT_FOUND = 404;
const PROFILE_PANELS = ['Top pages', 'Top tools', 'Countries'] as const;
/** Inline link inside a ranked list row. */
const ROW_LINK =
  'rounded-sm outline-none hover:text-link focus-visible:ring-2 focus-visible:ring-ring/60';

/**
 * One verified user: totals, the pages and tools they use most, where they connect from, and a
 * combined timeline of API calls, page views and tool uses. Reached ONLY through
 * PAGES.userDetail(userKey) — the opaque HMAC, never the email.
 */
export function UserDetailView({ userKey }: { userKey: string }) {
  const { filters } = useGlobalFilters();
  const profile = useUserProfile(userKey, filters);
  const apps = useAppList();
  const usersHref = withQuery(PAGES.users(), filterLinkQuery(filters));
  // The trail names the user by MASKED email only (it reads like a title; ADR 0006).
  const email = profile.data?.summary.email;
  const breadcrumbs = (
    <Breadcrumbs
      items={[{ label: 'Users', href: usersHref }, { label: email ? maskEmail(email) : 'User' }]}
    />
  );

  if (profile.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="User" eyebrow={breadcrumbs} />
        <Card>
          {isNoActivity(profile.error, filters.app, apps.data) ? (
            <EmptyState
              icon={UserX}
              title="No activity for this user in this range"
              description="This user has no recorded activity in the selected window."
              action={<WidenRangeButton />}
            />
          ) : (
            <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />
          )}
        </Card>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {profile.isPending ? (
        <ProfileSkeleton eyebrow={breadcrumbs} />
      ) : (
        <ProfileContent
          userKey={userKey}
          profile={profile.data}
          filters={filters}
          eyebrow={breadcrumbs}
        />
      )}
      <TimelinePanel userKey={userKey} filters={filters} />
    </div>
  );
}

/**
 * Whether a profile error means "no activity in this window" (pure; unit-tested). The API answers
 * 404 NOT_FOUND both when the user did nothing in the window AND when `?app=` names an unknown app
 * (a stale or mistyped slug). WHY the app check: the second is a real fault the user must see
 * (ErrorState with the API message), not an invitation to widen the range. While the app list is
 * unknown (loading or failed) the common case — no activity — wins.
 */
export function isNoActivity(
  error: unknown,
  app: string | undefined,
  registeredApps: readonly AppDto[] | undefined,
): boolean {
  const notFound =
    error instanceof ApiError &&
    error.status === HTTP_NOT_FOUND &&
    error.code === ERROR_CODES.NOT_FOUND;
  if (!notFound) return false;
  if (!app || !registeredApps) return true;
  return registeredApps.some((registered) => registered.slug === app);
}

function ProfileSkeleton({ eyebrow }: { eyebrow: ReactNode }) {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        {eyebrow}
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
            <OnlineBadge userKey={userKey} />
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
        <KpiCard
          label="API requests"
          info={metricInfo('requests')}
          icon={Activity}
          value={formatInteger(summary.requests)}
        />
        <KpiCard
          label="Failed requests"
          info={metricInfo('failedRequests')}
          icon={TriangleAlert}
          value={formatInteger(profile.failedRequests)}
          hint={failedShare !== null ? `${formatPercent(failedShare)} of requests` : undefined}
          href={profile.failedRequests > 0 ? failuresHref : undefined}
        />
        <KpiCard
          label="Page views"
          info={metricInfo('pageViews')}
          icon={Eye}
          value={formatInteger(summary.pageViews)}
        />
        <KpiCard
          label="Sessions"
          info={metricInfo('sessions')}
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
        <tr className="text-2xs text-muted-foreground uppercase">
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
