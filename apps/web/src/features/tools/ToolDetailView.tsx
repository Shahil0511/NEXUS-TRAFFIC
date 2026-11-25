'use client';

import type { ToolDetailDto } from '@nexus/shared';
import { ChartArea, Layers, MousePointerClick } from 'lucide-react';
import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';

import { AppChip } from '@/components/AppChip';
import { applicationCrumbs, Breadcrumbs } from '@/components/Breadcrumbs';
import { CountChart } from '@/components/charts/CountChart';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { FactSheet, type Fact } from '@/components/FactSheet';
import { HeadlineSentence } from '@/components/HeadlineSentence';
import { PageHeader } from '@/components/PageHeader';
import { ChartSkeleton, ListSkeleton } from '@/components/Panel';
import { RankedList } from '@/components/RankedList';
import { ReportSheet, ReportSubsection } from '@/components/ReportSheet';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { WhoUsesIt } from '@/components/WhoUsesIt';
import { filterLinkQuery, useGlobalFilters } from '@/features/filters/useGlobalFilters';
import {
  EMPTY_VALUE,
  formatAgo,
  formatDateTime,
  formatInteger,
  formatWindowCaption,
  perGrain,
  withUnit,
} from '@/lib/format';
import { metricInfo } from '@/lib/metricCopy';
import { PAGES, withQuery } from '@/lib/pages';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

import { toolHeadline } from './toolHeadline';
import { useToolDetail } from './useToolDetail';

type LinkQuery = Record<string, string | undefined>;

/** What an empty `action` means on screen. */
const NO_ACTION_LABEL = 'not specified';

/**
 * One feature (a named UI tool) of one app as a report sheet (components/ReportSheet): a sentence
 * with its numbers, a facts strip, uses over time, how it is used beside who uses it, and the
 * pages it is used on. Who uses it: names for admins only (the API sends topUsers null to everyone
 * else, ADR 0019). Reached ONLY through PAGES.toolDetail(app, toolId) — the opaque id, never the
 * name. On screen it is a "feature"; the route, ids and types keep the name "tool".
 */
export function ToolDetailView({ app, toolId }: { app: string; toolId: string }) {
  const { filters: globalFilters } = useGlobalFilters();
  const filters = useMemo(() => ({ ...globalFilters, app }), [globalFilters, app]);
  const linkQuery = useMemo(() => filterLinkQuery(filters), [filters]);
  const detail = useToolDetail(app, toolId, filters);
  useDocumentTitle(detail.data?.tool.tool);

  // Applications › <app> › Features › <feature>: the name is link TEXT only, never a URL part.
  const breadcrumbs = (
    <Breadcrumbs
      items={[
        ...applicationCrumbs(app, linkQuery),
        { label: 'Features', href: withQuery(PAGES.tools(), linkQuery) },
        { label: detail.data?.tool.tool ?? 'Feature' },
      ]}
    />
  );

  if (detail.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Feature" eyebrow={breadcrumbs} />
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
        <Skeleton className="h-7 w-64 max-w-full" />
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

/** The four numbers of the feature with their definitions (the old KPI cards, as one strip). */
function toolFacts(tool: ToolDetailDto['tool'], nowMs: number): Fact[] {
  return [
    { label: 'Uses', value: formatInteger(tool.uses), info: metricInfo('toolUses') },
    {
      label: 'People',
      value: formatInteger(tool.distinctUsers),
      note: 'verified',
      info: metricInfo('uniqueUsers'),
    },
    { label: 'Visits', value: formatInteger(tool.distinctSessions), info: metricInfo('sessions') },
    {
      label: 'Last used',
      value: formatAgo(tool.lastUsedAt, nowMs) ?? EMPTY_VALUE,
      note: withUnit(formatDateTime(tool.lastUsedAt), 'IST'),
    },
  ];
}

function DetailContent({
  detail,
  linkQuery,
  eyebrow,
}: {
  detail: ToolDetailDto;
  linkQuery: LinkQuery;
  eyebrow: ReactNode;
}) {
  const { tool, window } = detail;
  const nowMs = Date.now();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={eyebrow}
        title={tool.tool}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <AppChip app={tool.app} linkQuery={linkQuery} />
            <span>{formatWindowCaption(window)}</span>
          </span>
        }
        headline={<HeadlineSentence parts={toolHeadline(tool, nowMs)} />}
      />

      <ReportSheet
        headlineFacts={<FactSheet ariaLabel="Feature facts" facts={toolFacts(tool, nowMs)} />}
        chart={{
          title: 'Uses over time',
          icon: ChartArea,
          description: `Uses ${perGrain(window.grain)}`,
          content: (
            <CountChart
              points={tool.trend.map((point) => ({ bucket: point.bucket, count: point.uses }))}
              grain={window.grain}
              label="Uses"
            />
          ),
        }}
        around={{
          title: 'How it is used',
          icon: MousePointerClick,
          description: 'What was done with it (click, export, search…)',
          content: (
            <RankedList
              ariaLabel="Actions"
              items={detail.actions.map((action) => ({
                key: action.action ?? NO_ACTION_LABEL,
                label: action.action ?? (
                  <span className="text-muted-foreground italic">{NO_ACTION_LABEL}</span>
                ),
                value: action.uses,
              }))}
            />
          ),
        }}
        who={
          <WhoUsesIt
            count={tool.distinctUsers}
            users={detail.topUsers}
            unit="uses"
            ariaLabel="Who uses this feature"
            linkQuery={linkQuery}
          />
        }
        second={{
          title: 'Used with',
          icon: Layers,
          description: 'The pages it is used on',
          content: (
            <ReportSubsection title="Used on pages" description="Where in the app it is used">
              <UsedOnPages detail={detail} linkQuery={linkQuery} />
            </ReportSubsection>
          ),
        }}
      />
    </div>
  );
}

/** The pages the feature was used on, each opening its page detail. */
function UsedOnPages({ detail, linkQuery }: { detail: ToolDetailDto; linkQuery: LinkQuery }) {
  if (detail.pages.length === 0) return <EmptyState className="py-6" title="No page recorded" />;
  return (
    <RankedList
      ariaLabel="Used on pages"
      items={detail.pages.map((page) => ({
        key: page.pageId,
        label: (
          <Link
            href={withQuery(PAGES.pageDetail(detail.tool.app, page.pageId), linkQuery)}
            className="rounded-sm font-mono outline-none hover:text-link focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            {page.pathTemplate}
          </Link>
        ),
        value: page.uses,
      }))}
    />
  );
}
