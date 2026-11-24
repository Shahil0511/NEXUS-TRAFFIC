'use client';

import { type AppDto, ERROR_CODES } from '@nexus/shared';
import {
  Activity,
  CalendarDays,
  LayoutDashboard,
  MonitorSmartphone,
  TriangleAlert,
  UserX,
  Waypoints,
} from 'lucide-react';
import Link from 'next/link';

import { Breadcrumbs } from '@/components/Breadcrumbs';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { KpiCard } from '@/components/KpiCard';
import { PageHeader } from '@/components/PageHeader';
import { isForbidden, PersonAdminOnly } from '@/components/PersonAdminOnly';
import { ListSkeleton, Panel } from '@/components/Panel';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WidenRangeButton } from '@/components/WidenRangeButton';
import { useAppList } from '@/features/apps/useAppList';
import { filterLinkQuery, useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { useMe } from '@/features/me/useMe';
import { ApiError } from '@/lib/apiError';
import { PAGES, withQuery } from '@/lib/pages';
import { maskEmail, useDocumentTitle } from '@/lib/useDocumentTitle';

import { PersonIdentityCard } from './PersonIdentityCard';
import { UserActivityTab } from './UserActivityTab';
import { UserDailyActivityTab } from './UserDailyActivityTab';
import { isUserDetailTab, useUserDetailTab, type UserDetailTab } from './userDetailParams';
import { UserDevicesTab } from './UserDevicesTab';
import { UserSummaryTab } from './UserSummaryTab';
import { useUserProfile } from './useUserProfile';

const HTTP_NOT_FOUND = 404;
const SUMMARY_PANELS = ['Top pages', 'Top tools', 'Countries'] as const;

const TAB_LABELS: Record<UserDetailTab, string> = {
  summary: 'Summary',
  daily: 'Daily activity',
  devices: 'Devices',
  activity: 'Activity',
};
const TAB_ICONS = {
  summary: LayoutDashboard,
  daily: CalendarDays,
  devices: MonitorSmartphone,
  activity: Activity,
} as const satisfies Record<UserDetailTab, unknown>;

/**
 * One verified person's page — ADMINS ONLY (the API answers 403 to anyone else, and records each
 * admin open in the person access log). Decided from the viewer (useMe) BEFORE any person read is
 * sent; a 403 from the API (e.g. the admin list changed) shows the same state. While the viewer is
 * unknown (loading) nothing about the person is requested.
 * @see ../../components/PersonAdminOnly.tsx
 */
export function UserDetailView({ userKey }: { userKey: string }) {
  const me = useMe();
  if (me.isPending) return <PersonPageSkeleton />;
  if (me.data && !me.data.isAdmin) return <PersonAdminOnly />;
  return <PersonDetail userKey={userKey} />;
}

/**
 * One verified person over the GLOBAL range: an identity card that never disappears (email,
 * online now, apps, first / last activity, latest known device facts; a left column on 2xl screens, a
 * band above the tabs below that, so the tab tables get the full width) and the tabs,
 * kept in the URL (`?tab=`): Summary, Daily activity, Devices, Activity. The profile read (header,
 * identity card and Summary) is sent on every open, so the access log names that row "Identity
 * card and Summary"; every other tab sends its own read only while it is open, so the log records
 * the parts that were actually shown. Reached ONLY through
 * PAGES.userDetail(userKey) — the opaque HMAC, never the email.
 */
function PersonDetail({ userKey }: { userKey: string }) {
  const { filters } = useGlobalFilters();
  const profile = useUserProfile(userKey, filters);
  const apps = useAppList();
  const { tab, setTab } = useUserDetailTab();
  const linkQuery = filterLinkQuery(filters);
  const usersHref = withQuery(PAGES.users(), linkQuery);
  const visitsHref = withQuery(PAGES.journeys(), { ...linkQuery, userKey });
  const failuresHref = withQuery(PAGES.errors(), { ...linkQuery, userKey });
  // The trail and the tab title name the person by MASKED email only (ADR 0006).
  const email = profile.data?.summary.email;
  useDocumentTitle(email ? maskEmail(email) : undefined);
  const breadcrumbs = (
    <Breadcrumbs
      items={[{ label: 'People', href: usersHref }, { label: email ? maskEmail(email) : 'Person' }]}
    />
  );

  if (profile.isError && isForbidden(profile.error)) return <PersonAdminOnly />;
  // A 404 for a registered app is "nothing in this range", not a failure: the card then says
  // there is no browser activity (latest null) instead of "could not load".
  const noActivity = profile.isError && isNoActivity(profile.error, filters.app, apps.data);

  return (
    <div className="space-y-6">
      {profile.isPending ? (
        <div className="space-y-2" aria-busy="true">
          {breadcrumbs}
          <Skeleton className="h-7 w-72" />
        </div>
      ) : (
        <PageHeader
          eyebrow={breadcrumbs}
          title={email ?? 'Person'}
          description="How this person uses the apps in the selected range."
          actions={
            profile.data ? (
              <>
                {profile.data.failedRequests > 0 ? (
                  <Button asChild variant="outline">
                    <Link href={failuresHref}>
                      <TriangleAlert aria-hidden="true" /> View failures
                    </Link>
                  </Button>
                ) : null}
                <Button asChild variant="outline">
                  <Link href={visitsHref}>
                    <Waypoints aria-hidden="true" /> View visits
                  </Link>
                </Button>
              </>
            ) : undefined
          }
        />
      )}

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] 2xl:items-start">
        <PersonIdentityCard
          userKey={userKey}
          profile={profile.data}
          loading={profile.isPending}
          latest={noActivity ? null : profile.data?.latest}
          latestFailed={profile.isError && !noActivity}
          linkQuery={linkQuery}
        />

        <div className="min-w-0">
          {profile.isError ? (
            <Card>
              {noActivity ? (
                <EmptyState
                  icon={UserX}
                  title="No activity for this person in this range"
                  description="This person has no recorded activity in the selected range."
                  action={<WidenRangeButton />}
                />
              ) : (
                <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />
              )}
            </Card>
          ) : (
            <Tabs value={tab} onValueChange={(value) => isUserDetailTab(value) && setTab(value)}>
              <TabsList aria-label="Person page sections">
                {(Object.keys(TAB_LABELS) as UserDetailTab[]).map((value) => {
                  const Icon = TAB_ICONS[value];
                  return (
                    <TabsTrigger key={value} value={value}>
                      <Icon aria-hidden="true" /> {TAB_LABELS[value]}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
              <TabsContent value="summary">
                {profile.data ? (
                  <UserSummaryTab
                    profile={profile.data}
                    linkQuery={linkQuery}
                    visitsHref={visitsHref}
                    failuresHref={failuresHref}
                  />
                ) : (
                  <SummarySkeleton />
                )}
              </TabsContent>
              <TabsContent value="daily">
                <UserDailyActivityTab userKey={userKey} filters={filters} />
              </TabsContent>
              <TabsContent value="devices">
                <UserDevicesTab userKey={userKey} filters={filters} linkQuery={linkQuery} />
              </TabsContent>
              <TabsContent value="activity">
                <UserActivityTab userKey={userKey} filters={filters} />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
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

/** While the viewer is being looked up: the page frame, no person data. */
function PersonPageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-72" />
      </div>
      <div className="grid gap-6 2xl:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] 2xl:items-start">
        <Skeleton className="h-40 w-full rounded-2xl 2xl:h-80" />
        <SummarySkeleton />
      </div>
    </div>
  );
}

function SummarySkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <KpiCard key={index} label="" value="" loading />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        {SUMMARY_PANELS.map((title) => (
          <Panel key={title} title={title}>
            <ListSkeleton rows={4} />
          </Panel>
        ))}
      </div>
    </div>
  );
}
