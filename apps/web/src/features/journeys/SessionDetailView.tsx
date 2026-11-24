'use client';

import type { SessionDetailDto, SessionSummaryDto } from '@nexus/shared';
import { ArrowLeftRight, Clock, Eye, Hourglass, MousePointerClick, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';

import { ClaimedBadge } from '@/components/ClaimedBadge';
import { CopyableText } from '@/components/CopyButton';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { AppChip } from '@/components/AppChip';
import { applicationCrumbs, Breadcrumbs } from '@/components/Breadcrumbs';
import { KpiCard } from '@/components/KpiCard';
import { PageHeader } from '@/components/PageHeader';
import { ListSkeleton, Panel } from '@/components/Panel';
import { isForbidden, PersonAdminOnly } from '@/components/PersonAdminOnly';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { filterLinkQuery, useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { useCanOpenPersonPages } from '@/features/me/useCanOpenPersonPages';
import { formatCountry, formatDateTime, formatDuration, formatInteger } from '@/lib/format';
import { metricInfo } from '@/lib/metricCopy';
import { PAGES, withQuery } from '@/lib/pages';

import { SessionReplay } from './SessionReplay';
import { useSessionDetail } from './useSessionDetail';

/** Characters of the session uuid shown in the title. */
const SESSION_ID_PREVIEW = 8;
const CLIENT_ERROR_MIN = 400;

/**
 * One browser session replayed: who, how long, and every page in order with its visible time,
 * the tools used on it and the API calls it made. Reached ONLY through
 * PAGES.sessionDetail(app, sessionId) — the registered app slug and the session uuid. The title
 * shows a short id; the header carries the full one with a copy button for support tickets.
 */
export function SessionDetailView({ app, sessionId }: { app: string; sessionId: string }) {
  const { filters: globalFilters } = useGlobalFilters();
  // The session belongs to ONE app: its slug (from the path) is the app scope of every link —
  // a stale ?app=other must not send "Visits", the profile or the replay links elsewhere.
  const filters = useMemo(() => ({ ...globalFilters, app }), [globalFilters, app]);
  const linkQuery = useMemo(() => filterLinkQuery(filters), [filters]);
  const detail = useSessionDetail(app, sessionId, filters);
  const title = `Visit ${sessionId.slice(0, SESSION_ID_PREVIEW)}`;
  const backLink = (
    <Breadcrumbs
      items={[
        ...applicationCrumbs(app, linkQuery),
        { label: 'Visits', href: withQuery(PAGES.journeys(), linkQuery) },
        { label: title },
      ]}
    />
  );

  // A visit of a verified person is admin-only (ADR 0017): the API answers 403 to anyone else.
  // @see ../../components/PersonAdminOnly.tsx
  if (detail.isError && isForbidden(detail.error)) {
    return (
      <PersonAdminOnly
        title={title}
        eyebrow={backLink}
        heading="Only admins can open this visit"
        description="This visit belongs to a signed-in person, so its steps are part of that person's data and only dashboard admins can open them. Visits without a signed-in person, and the People list, stay open to you."
      />
    );
  }
  if (detail.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title={title} eyebrow={backLink} />
        <Card>
          <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
        </Card>
      </div>
    );
  }
  return detail.isPending ? (
    <DetailSkeleton eyebrow={backLink} />
  ) : (
    <DetailContent title={title} detail={detail.data} linkQuery={linkQuery} eyebrow={backLink} />
  );
}

function DetailSkeleton({ eyebrow }: { eyebrow: ReactNode }) {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        {eyebrow}
        <Skeleton className="h-7 w-64" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <KpiCard key={index} label="" value="" loading />
        ))}
      </div>
      <Panel title="Visit steps">
        <ListSkeleton rows={6} />
      </Panel>
    </div>
  );
}

/** Verified email, a flagged browser claim, or anonymous — plus IP (admins) and country. */
function SessionIdentity({ session }: { session: SessionSummaryDto }) {
  const where = [session.ip, session.country ? formatCountry(session.country) : null]
    .filter((part): part is string => !!part)
    .join(' · ');
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <UserRound className="size-3.5 shrink-0" aria-hidden="true" />
      {session.userEmail ? (
        <span className="truncate text-foreground">{session.userEmail}</span>
      ) : session.claimedEmail ? (
        <>
          <span className="truncate">{session.claimedEmail}</span>
          <ClaimedBadge />
        </>
      ) : (
        <span className="italic">anonymous</span>
      )}
      {where ? <span className="font-mono text-2xs">· {where}</span> : null}
    </span>
  );
}

type LinkQuery = Readonly<Record<string, string | undefined>>;

interface DetailContentProps {
  title: string;
  detail: SessionDetailDto;
  /** The global filters scoped to the session's app — every link on the page carries it. */
  linkQuery: LinkQuery;
  eyebrow: ReactNode;
}

function DetailContent({ title, detail, linkQuery, eyebrow }: DetailContentProps) {
  const { summary, events } = detail;
  // The person page is admin-only: nobody else gets a button that leads to a refusal.
  const canOpenPerson = useCanOpenPersonPages();
  const apiCalls = events.filter((event) => event.kind === 'api');
  const failedCalls = apiCalls.filter(
    (event) => event.status !== null && event.status >= CLIENT_ERROR_MIN,
  ).length;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <AppChip app={summary.app} linkQuery={linkQuery} />
            <CopyableText value={summary.sessionId} label="visit id" className="max-w-72 text-xs" />
            <span>Started {formatDateTime(summary.startedAt)} IST</span>
            <SessionIdentity session={summary} />
          </span>
        }
        actions={
          summary.userKey && canOpenPerson ? (
            <Button asChild variant="outline">
              <Link href={withQuery(PAGES.userDetail(summary.userKey), linkQuery)}>
                <UserRound aria-hidden="true" /> Person page
              </Link>
            </Button>
          ) : null
        }
      />

      <section
        aria-label="Visit metrics"
        className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5"
      >
        <KpiCard label="Duration" icon={Clock} value={formatDuration(summary.durationMs)} />
        <KpiCard
          label="Visible time"
          info={metricInfo('visibleTime')}
          icon={Hourglass}
          value={formatDuration(summary.visibleMs)}
          hint="tab in foreground"
        />
        <KpiCard label="Page views" icon={Eye} value={formatInteger(summary.pageViews)} />
        <KpiCard
          label="Tool uses"
          icon={MousePointerClick}
          value={formatInteger(summary.toolUses)}
        />
        <KpiCard
          label="API calls"
          icon={ArrowLeftRight}
          value={formatInteger(apiCalls.length)}
          hint={failedCalls > 0 ? `${formatInteger(failedCalls)} failed` : undefined}
        />
      </section>

      <Panel
        title="Visit steps"
        description="Each page with its visible time, then the tools used and API calls made on it"
      >
        {events.length > 0 ? (
          <SessionReplay events={events} startedAt={summary.startedAt} linkQuery={linkQuery} />
        ) : (
          <EmptyState title="No events recorded" />
        )}
      </Panel>
    </div>
  );
}
