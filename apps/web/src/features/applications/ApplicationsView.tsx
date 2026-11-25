'use client';

import { UserCheck } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';

import { DataTable } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { HeadlineSentence } from '@/components/HeadlineSentence';
import type { CheckState } from '@/components/HealthMark';
import { PageHeader } from '@/components/PageHeader';
import { RelativeTime } from '@/components/RelativeTime';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { filterLinkQuery, useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { healthMarkOf } from '@/features/integration/healthMark';
import { useIntegrationHealth } from '@/features/integration/useIntegrationHealth';
import { onlineCountOf, useOnlineNow } from '@/features/live/useOnlineNow';
import { formatWindowCaption } from '@/lib/format';
import { PAGES } from '@/lib/pages';

import { appsHeadline } from './appsHeadline';
import { appTrafficColumns } from './appTrafficColumns';
import { useAppTraffic } from './useAppTraffic';

/**
 * The Applications page: every registered app side by side — users, API calls, error rate,
 * latency, page views, sessions and tool uses, each with its change versus the previous window,
 * plus how many people are in each app right now (useOnlineNow, polled every 15 s).
 * Answers "how is each app doing and who uses it?"; a row opens the app's own page.
 *
 * WHY a headline sentence: the totals (apps, sending data, API calls, apps failing often) read as
 * one sentence in the page hero (appsHeadline), not a KPI card row. WHY the health mark: each row
 * starts with the app's Data health (useIntegrationHealth → healthMarkOf). That mark is Data
 * health NOW (its last 24 h), independent of the page's range, like "Online now"; while it loads
 * or if its read fails the table still renders, just without marks.
 */
export function ApplicationsView() {
  const { filters } = useGlobalFilters();
  // The app filter does not apply here (this page IS the per-app breakdown).
  const query = useAppTraffic({ ...filters, app: undefined });
  // Who is online right now, in every app (never range- or app-filtered), merged by slug.
  const online = useOnlineNow({});
  const linkQuery = useMemo(() => filterLinkQuery(filters), [filters]);
  // Data health now (last 24 h, every app), merged by slug; never blocks the table.
  const health = useIntegrationHealth();
  const onlineData = online.data;
  const healthBySlug = useMemo(
    () =>
      new Map<string, CheckState>(
        (health.data?.apps ?? []).map((entry) => [entry.app, healthMarkOf(entry)]),
      ),
    [health.data],
  );
  const columns = useMemo(
    () =>
      appTrafficColumns(
        linkQuery,
        (iso) => <RelativeTime iso={iso} />,
        (app) => (onlineData ? onlineCountOf(onlineData, app) : undefined),
        (app) => healthBySlug.get(app),
      ),
    [linkQuery, onlineData, healthBySlug],
  );
  const items = query.data?.items;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Apps"
        description={
          query.data
            ? formatWindowCaption(query.data.window)
            : 'Every app side by side: who uses it, how much, and how well it works'
        }
        headline={
          items ? (
            <HeadlineSentence parts={appsHeadline(items, linkQuery)} />
          ) : query.isPending ? (
            <Skeleton className="h-7 w-full max-w-xl" />
          ) : null
        }
      />

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
