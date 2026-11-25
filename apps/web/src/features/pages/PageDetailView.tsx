'use client';

import type { PageDetailDto, PageLinkDto } from '@nexus/shared';
import { ChartArea, Layers, Waypoints } from 'lucide-react';
import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';

import { AppChip } from '@/components/AppChip';
import { applicationCrumbs, Breadcrumbs } from '@/components/Breadcrumbs';
import { CountChart } from '@/components/charts/CountChart';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { FactSheet, type Fact } from '@/components/FactSheet';
import { HeadlineSentence } from '@/components/HeadlineSentence';
import { MethodBadge } from '@/components/MethodBadge';
import { PageHeader } from '@/components/PageHeader';
import { ChartSkeleton, ListSkeleton } from '@/components/Panel';
import { RankedList } from '@/components/RankedList';
import { ReportSheet, ReportSubsection } from '@/components/ReportSheet';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { WhoUsesIt } from '@/components/WhoUsesIt';
import { filterLinkQuery, useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { countPhrase } from '@/lib/countPhrase';
import {
  formatDuration,
  formatInteger,
  formatPercent,
  formatWindowCaption,
  perGrain,
} from '@/lib/format';
import { metricInfo } from '@/lib/metricCopy';
import { PAGES, withQuery } from '@/lib/pages';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

import { exitRateOf, pageHeadline } from './pageHeadline';
import { usePageDetail } from './usePageDetail';

type LinkQuery = Record<string, string | undefined>;

/** Inline link inside a list row. */
const ROW_LINK =
  'rounded-sm outline-none hover:text-link focus-visible:ring-2 focus-visible:ring-ring/60';

/**
 * One page of one app as a report sheet (components/ReportSheet): a sentence with its numbers,
 * a facts strip, views over time, where people come from / go next beside who views it, and the
 * features and request types used with it. Who views it: names for admins only (the API sends
 * topUsers null to everyone else, ADR 0019). Reached ONLY through PAGES.pageDetail(app, pageId) —
 * the opaque id, never the template.
 */
export function PageDetailView({ app, pageId }: { app: string; pageId: string }) {
  const { filters: globalFilters } = useGlobalFilters();
  // The page belongs to ONE app: its slug (from the path) is the app scope of every link.
  const filters = useMemo(() => ({ ...globalFilters, app }), [globalFilters, app]);
  const linkQuery = useMemo(() => filterLinkQuery(filters), [filters]);
  const detail = usePageDetail(app, pageId, filters);
  useDocumentTitle(detail.data?.page.pathTemplate);

  // Applications › <app> › Pages › <template>: the template is link TEXT only, never a URL part.
  const breadcrumbs = (
    <Breadcrumbs
      items={[
        ...applicationCrumbs(app, linkQuery),
        { label: 'Pages', href: withQuery(PAGES.pages(), linkQuery) },
        { label: detail.data?.page.pathTemplate ?? 'Page' },
      ]}
    />
  );

  if (detail.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Page" eyebrow={breadcrumbs} />
        <Card>
          <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
        </Card>
      </div>
    );
  }
  if (detail.isPending) return <DetailSkeleton eyebrow={breadcrumbs} />;
  return <DetailContent detail={detail.data} linkQuery={linkQuery} eyebrow={breadcrumbs} />;
}

/** The sheet's shape while loading: header, sentence, facts line, chart and two columns. */
function DetailSkeleton({ eyebrow }: { eyebrow: ReactNode }) {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        {eyebrow}
        <Skeleton className="h-7 w-80 max-w-full" />
        <Skeleton className="h-6 w-full max-w-2xl" />
      </div>
      <Skeleton className="h-11 w-full" />
      <ChartSkeleton />
      <div className="grid gap-4 lg:grid-cols-2">
        <ListSkeleton />
        <ListSkeleton />
      </div>
    </div>
  );
}

/** The six numbers of the page with their definitions (the old KPI cards, as one strip). */
function pageFacts(page: PageDetailDto['page']): Fact[] {
  const exitRate = exitRateOf(page);
  return [
    { label: 'Views', value: formatInteger(page.views), info: metricInfo('pageViews') },
    {
      label: 'People',
      value: formatInteger(page.distinctUsers),
      note: 'verified',
      info: metricInfo('uniqueUsers'),
    },
    { label: 'Visits', value: formatInteger(page.uniqueSessions), info: metricInfo('sessions') },
    {
      label: 'Average visible',
      value: page.avgVisibleMs === null ? null : formatDuration(page.avgVisibleMs),
      note: 'tab in foreground',
      info: metricInfo('visibleTime'),
    },
    {
      label: 'Median visible',
      value: page.p50VisibleMs === null ? null : formatDuration(page.p50VisibleMs),
      info: metricInfo('visibleTime'),
    },
    {
      label: 'Exit rate',
      value: exitRate === null ? null : formatPercent(exitRate),
      note: `${countPhrase(page.exits, 'visit', 'visits')} ended here`,
      info: metricInfo('exitRate'),
    },
  ];
}

function DetailContent({
  detail,
  linkQuery,
  eyebrow,
}: {
  detail: PageDetailDto;
  linkQuery: LinkQuery;
  eyebrow: ReactNode;
}) {
  const { page, window } = detail;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={eyebrow}
        title={page.pathTemplate}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <AppChip app={page.app} linkQuery={linkQuery} />
            <span>{formatWindowCaption(window)}</span>
          </span>
        }
        headline={<HeadlineSentence parts={pageHeadline(page)} />}
      />

      <ReportSheet
        headlineFacts={<FactSheet ariaLabel="Page facts" facts={pageFacts(page)} />}
        chart={{
          title: 'Views over time',
          icon: ChartArea,
          description: `Views ${perGrain(window.grain)}`,
          content: (
            <CountChart
              points={detail.trend.map((point) => ({ bucket: point.bucket, count: point.views }))}
              grain={window.grain}
              label="Views"
            />
          ),
        }}
        around={{
          title: 'What happens around it',
          icon: Waypoints,
          description: 'Where visits come from and go next',
          content: <AroundThePage detail={detail} linkQuery={linkQuery} />,
        }}
        who={
          <WhoUsesIt
            count={page.distinctUsers}
            users={detail.topUsers}
            unit="views"
            ariaLabel="Who views this page"
            linkQuery={linkQuery}
          />
        }
        second={{
          title: 'Used with',
          icon: Layers,
          description: 'Features and request types used while this page was open',
          content: <UsedWithThePage detail={detail} linkQuery={linkQuery} />,
        }}
      />
    </div>
  );
}

/** Came from | Went to, side by side when there is room. */
function AroundThePage({ detail, linkQuery }: { detail: PageDetailDto; linkQuery: LinkQuery }) {
  return (
    <div className="grid min-w-0 gap-6 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
      <ReportSubsection title="Came from" description="The page just before, by visits">
        <PageLinkList
          app={detail.page.app}
          ariaLabel="Came from"
          links={detail.cameFrom}
          linkQuery={linkQuery}
          empty="Entry page: nothing before it"
        />
      </ReportSubsection>
      <ReportSubsection title="Went to" description="The page just after, by visits">
        <PageLinkList
          app={detail.page.app}
          ariaLabel="Went to"
          links={detail.wentTo}
          linkQuery={linkQuery}
          empty="Nothing after it in these visits"
        />
      </ReportSubsection>
    </div>
  );
}

/** Features used on the page | request types called from it, side by side from md. */
function UsedWithThePage({ detail, linkQuery }: { detail: PageDetailDto; linkQuery: LinkQuery }) {
  const { page } = detail;
  return (
    <div className="grid min-w-0 gap-6 md:grid-cols-2">
      <ReportSubsection title="Features used on this page" description="Named features, by uses">
        {detail.tools.length > 0 ? (
          <RankedList
            ariaLabel="Features used on this page"
            items={detail.tools.map((tool) => ({
              key: tool.toolId,
              label: (
                <Link
                  href={withQuery(PAGES.toolDetail(page.app, tool.toolId), linkQuery)}
                  className={ROW_LINK}
                >
                  {tool.tool}
                </Link>
              ),
              sublabel: `${formatInteger(tool.users)} people`,
              value: tool.uses,
            }))}
          />
        ) : (
          <EmptyState
            className="py-6"
            title="No feature used here"
            description="No tracked feature was used on this page."
          />
        )}
      </ReportSubsection>
      <ReportSubsection
        title="Request types called from this page"
        description="API routes called while the page was open"
      >
        {detail.apiCalls.length > 0 ? (
          <RankedList
            ariaLabel="Request types called from this page"
            items={detail.apiCalls.map((call) => ({
              key: call.endpointId,
              label: (
                <Link
                  href={withQuery(PAGES.endpointDetail(call.endpointId), linkQuery)}
                  className={`inline-flex min-w-0 max-w-full items-center gap-1.5 ${ROW_LINK}`}
                >
                  <MethodBadge method={call.method} />
                  <span className="truncate font-mono">{call.routeTemplate}</span>
                </Link>
              ),
              sublabel: `${formatInteger(call.failed)} failed · p95 ${formatDuration(call.p95Ms)}`,
              value: call.calls,
            }))}
          />
        ) : (
          <EmptyState
            className="py-6"
            title="No linked API calls"
            description="API calls are linked to a page only when the app's tracker sends the session headers."
          />
        )}
      </ReportSubsection>
    </div>
  );
}

/** Neighbour pages (came from / went to), each opening its own page detail. */
function PageLinkList({
  app,
  ariaLabel,
  links,
  linkQuery,
  empty,
}: {
  app: string;
  ariaLabel: string;
  links: readonly PageLinkDto[];
  linkQuery: LinkQuery;
  empty: string;
}) {
  if (links.length === 0) return <EmptyState className="py-6" title={empty} />;
  return (
    <RankedList
      ariaLabel={ariaLabel}
      format={(value) => countPhrase(value, 'visit', 'visits')}
      items={links.map((link) => ({
        key: link.pageId,
        label: (
          <Link
            href={withQuery(PAGES.pageDetail(app, link.pageId), linkQuery)}
            className={`font-mono ${ROW_LINK}`}
          >
            {link.pathTemplate}
          </Link>
        ),
        value: link.sessions,
      }))}
    />
  );
}
