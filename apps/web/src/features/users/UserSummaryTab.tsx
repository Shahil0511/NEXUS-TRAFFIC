'use client';

import type { UserProfileDto } from '@nexus/shared';
import { Activity, Eye, TriangleAlert, Waypoints } from 'lucide-react';
import Link from 'next/link';

import { AppChip } from '@/components/AppChip';
import { EmptyState } from '@/components/EmptyState';
import { KpiCard } from '@/components/KpiCard';
import { MethodBadge } from '@/components/MethodBadge';
import { Panel } from '@/components/Panel';
import { RankedList } from '@/components/RankedList';
import { RelativeTime } from '@/components/RelativeTime';
import { Badge } from '@/components/ui/badge';
import { formatCountry, formatInteger, formatPercent } from '@/lib/format';
import { metricInfo } from '@/lib/metricCopy';
import { PAGES, withQuery } from '@/lib/pages';

const PERCENT = 100;
/** Inline link inside a ranked list row. */
const ROW_LINK =
  'rounded-sm outline-none hover:text-link focus-visible:ring-2 focus-visible:ring-ring/60';

export interface UserSummaryTabProps {
  profile: UserProfileDto;
  linkQuery: Record<string, string | undefined>;
  visitsHref: string;
  failuresHref: string;
}

/**
 * WHY: "what should I know first?" — the person's totals in the range, the apps they used and
 * the routes, pages and tools they use most. Totals of this one person only: no comparison with
 * anyone else.
 */
export function UserSummaryTab({
  profile,
  linkQuery,
  visitsHref,
  failuresHref,
}: UserSummaryTabProps) {
  const { summary } = profile;
  const failedShare =
    summary.requests > 0 ? (profile.failedRequests / summary.requests) * PERCENT : null;
  return (
    <div className="space-y-6">
      <section aria-label="User metrics" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
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
          label="Visits"
          info={metricInfo('sessions')}
          icon={Waypoints}
          value={formatInteger(summary.sessions)}
          hint="browser visits"
          href={summary.sessions > 0 ? visitsHref : undefined}
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Apps used" description="This person's activity per application">
          <AppsUsedTable apps={profile.perApp} linkQuery={linkQuery} />
        </Panel>
        <Panel title="Top API routes" description="The routes this person calls most">
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
            <EmptyState title="No API calls" description="Only the browser UI was used." />
          )}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
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
            <EmptyState title="No page views" description="Only API calls were recorded." />
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
        <Panel title="Countries" description="Where the activity came from (approximate)">
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
    </div>
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
