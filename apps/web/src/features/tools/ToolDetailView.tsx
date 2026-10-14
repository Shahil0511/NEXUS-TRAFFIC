'use client';

import type { ToolDetailDto } from '@nexus/shared';
import { ArrowLeft, Clock, MousePointerClick, UserCheck, Waypoints } from 'lucide-react';
import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';

import { AppChip } from '@/components/AppChip';
import { CountChart } from '@/components/charts/CountChart';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { KpiCard } from '@/components/KpiCard';
import { PageHeader } from '@/components/PageHeader';
import { ChartSkeleton, Panel } from '@/components/Panel';
import { RankedList } from '@/components/RankedList';
import { TopUsersList } from '@/components/TopUsersList';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { filterLinkQuery, useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { formatAgo, formatDateTime, formatInteger, formatWindowCaption } from '@/lib/format';
import { PAGES, withQuery } from '@/lib/pages';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

import { useToolDetail } from './useToolDetail';

type LinkQuery = Record<string, string | undefined>;

/** What an empty `action` means on screen. */
const NO_ACTION_LABEL = 'not specified';

/**
 * One tool (UI feature) of one app: how often it is used and by how many people, its trend, who
 * uses it most, on which pages and with which actions. Reached ONLY through
 * PAGES.toolDetail(app, toolId) — the opaque id, never the tool name.
 */
export function ToolDetailView({ app, toolId }: { app: string; toolId: string }) {
  const { filters: globalFilters } = useGlobalFilters();
  const filters = useMemo(() => ({ ...globalFilters, app }), [globalFilters, app]);
  const linkQuery = useMemo(() => filterLinkQuery(filters), [filters]);
  const detail = useToolDetail(app, toolId, filters);
  useDocumentTitle(detail.data?.tool.tool);

  const backLink = (
    <Link
      href={withQuery(PAGES.tools(), linkQuery)}
      className="inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <ArrowLeft className="size-3" aria-hidden="true" /> Tools
    </Link>
  );

  if (detail.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Tool" eyebrow={backLink} />
        <Card>
          <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
        </Card>
      </div>
    );
  }
  if (detail.isPending) return <DetailSkeleton eyebrow={backLink} />;
  return <DetailContent detail={detail.data} linkQuery={linkQuery} eyebrow={backLink} />;
}

function DetailSkeleton({ eyebrow }: { eyebrow: ReactNode }) {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">{eyebrow}</div>
        <Skeleton className="h-7 w-64" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <KpiCard key={index} label="" value="" loading />
        ))}
      </div>
      <Panel title="Uses over time">
        <ChartSkeleton />
      </Panel>
    </div>
  );
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
      />

      <section aria-label="Tool metrics" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Uses" icon={MousePointerClick} value={formatInteger(tool.uses)} />
        <KpiCard
          label="Users"
          icon={UserCheck}
          value={formatInteger(tool.distinctUsers)}
          hint="verified"
        />
        <KpiCard label="Sessions" icon={Waypoints} value={formatInteger(tool.distinctSessions)} />
        <KpiCard
          label="Last used"
          icon={Clock}
          value={formatAgo(tool.lastUsedAt, Date.now()) ?? '—'}
          hint={`${formatDateTime(tool.lastUsedAt)} IST`}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Uses over time" className="lg:col-span-2">
          <CountChart
            points={tool.trend.map((point) => ({ bucket: point.bucket, count: point.uses }))}
            grain={window.grain}
            label="Uses"
          />
        </Panel>
        <Panel title="Who uses it" description="Verified users by uses">
          <TopUsersList
            users={detail.topUsers}
            unit="uses"
            ariaLabel="Who uses this tool"
            linkQuery={linkQuery}
          />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Used on pages" description="Where in the app it is used">
          {detail.pages.length > 0 ? (
            <RankedList
              ariaLabel="Used on pages"
              items={detail.pages.map((page) => ({
                key: page.pageId,
                label: (
                  <Link
                    href={withQuery(PAGES.pageDetail(tool.app, page.pageId), linkQuery)}
                    className="rounded-sm font-mono outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    {page.pathTemplate}
                  </Link>
                ),
                value: page.uses,
              }))}
            />
          ) : (
            <EmptyState title="No page recorded" />
          )}
        </Panel>
        <Panel title="Actions" description="What was done with it (click, export, search…)">
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
        </Panel>
      </div>
    </div>
  );
}
