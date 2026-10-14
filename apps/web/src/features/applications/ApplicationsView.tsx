'use client';

import type { AppTrafficDto } from '@nexus/shared';
import { Activity, Boxes, PlugZap, TriangleAlert, UserCheck } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';

import { DataTable } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { KpiCard } from '@/components/KpiCard';
import { PageHeader } from '@/components/PageHeader';
import { RelativeTime } from '@/components/RelativeTime';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { filterLinkQuery, useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { formatCompact, formatInteger, formatWindowCaption } from '@/lib/format';
import { PAGES, withQuery } from '@/lib/pages';

import { appTrafficColumns, COVERAGE_WARN_PCT, isSilent } from './appTrafficColumns';
import { useAppTraffic } from './useAppTraffic';

/** Totals across apps for the header cards (users are NOT summed: one person uses several apps). */
function totalsOf(items: readonly AppTrafficDto[]) {
  return {
    active: items.filter((item) => !isSilent(item)).length,
    requests: items.reduce((sum, item) => sum + (item.requests.value ?? 0), 0),
    failing: items.filter((item) => (item.errorRate.value ?? 0) >= FAILING_ERROR_RATE).length,
  };
}

/** Error rate (%) from which an app counts as "needs attention" in the header card. */
const FAILING_ERROR_RATE = 5;

/**
 * The Applications page: every registered app side by side — users, API calls, error rate,
 * latency, page views, sessions and tool uses, each with its change versus the previous window.
 * Answers "how is each app doing and who uses it?"; a row opens the app's own page.
 */
export function ApplicationsView() {
  const { filters } = useGlobalFilters();
  // The app filter does not apply here (this page IS the per-app breakdown).
  const query = useAppTraffic({ ...filters, app: undefined });
  const linkQuery = useMemo(() => filterLinkQuery(filters), [filters]);
  const columns = useMemo(
    () => appTrafficColumns(linkQuery, (iso) => <RelativeTime iso={iso} />),
    [linkQuery],
  );
  const items = query.data?.items;
  const totals = items ? totalsOf(items) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Applications"
        description={
          query.data
            ? formatWindowCaption(query.data.window)
            : 'Every app side by side: who uses it, how much, and how well it works'
        }
      />
      <p className="-mt-3 text-xs text-muted-foreground">
        <strong className="font-medium text-foreground">Identified</strong> = share of events with a
        verified user (low → users are missing from Users).{' '}
        <strong className="font-medium text-foreground">Linked</strong> = share of API calls tied to
        a browser page (low → page → API drill-downs are incomplete). Below {COVERAGE_WARN_PCT} % is
        highlighted.
      </p>

      <section aria-label="Totals" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Registered apps"
          icon={Boxes}
          loading={query.isPending}
          value={formatInteger(items?.length)}
        />
        <KpiCard
          label="Sending data"
          icon={PlugZap}
          loading={query.isPending}
          value={totals ? `${totals.active} of ${items?.length ?? 0}` : ''}
          hint="in this range"
          href={withQuery(PAGES.integration(), {})}
        />
        <KpiCard
          label="API calls"
          icon={Activity}
          loading={query.isPending}
          value={formatCompact(totals?.requests)}
          href={withQuery(PAGES.endpoints(), linkQuery)}
        />
        <KpiCard
          label="Error rate ≥ 5 %"
          icon={TriangleAlert}
          loading={query.isPending}
          value={totals ? `${totals.failing} ${totals.failing === 1 ? 'app' : 'apps'}` : ''}
          href={withQuery(PAGES.errors(), linkQuery)}
        />
      </section>

      <Card className="overflow-hidden" aria-busy={query.isFetching}>
        {query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <DataTable
            caption="Applications"
            columns={columns}
            rows={items}
            rowKey={(row) => row.app}
            loading={query.isPending}
            empty={
              <EmptyState
                icon={UserCheck}
                title="No apps registered yet"
                description="Register an app and give its team the integration guide; its traffic appears here."
                action={
                  <Button asChild variant="outline" size="sm">
                    <Link href={PAGES.apps()}>Register an app</Link>
                  </Button>
                }
              />
            }
          />
        )}
      </Card>
    </div>
  );
}
