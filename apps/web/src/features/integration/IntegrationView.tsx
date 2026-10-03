'use client';

import {
  INTEGRATION_HEALTH_WINDOW_MS,
  type AppIntegrationHealthDto,
  type IntegrationHealthDto,
} from '@nexus/shared';
import { BookOpen, CheckCircle2, CircleDashed, Clock3, ListChecks, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';

import { EmptyState } from '@/components/EmptyState';
import { KpiCard } from '@/components/KpiCard';
import { PageHeader } from '@/components/PageHeader';
import { QueryState } from '@/components/QueryState';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { formatDateTime, formatInteger } from '@/lib/format';
import { guideHref } from '@/lib/guide';
import { PAGES } from '@/lib/pages';

import { AppHealthCard } from './AppHealthCard';
import { useIntegrationHealth } from './useIntegrationHealth';

const WINDOW_HOURS = Math.round(INTEGRATION_HEALTH_WINDOW_MS / 3_600_000);

export interface HealthTally {
  healthy: number;
  stale: number;
  never: number;
  needsAttention: number;
}

/** Headline counts of the visible apps (an app with any warning needs attention). */
export function tallyHealth(apps: readonly AppIntegrationHealthDto[]): HealthTally {
  return {
    healthy: apps.filter((app) => app.status === 'healthy').length,
    stale: apps.filter((app) => app.status === 'stale').length,
    never: apps.filter((app) => app.status === 'never').length,
    needsAttention: apps.filter((app) => app.warnings.length > 0).length,
  };
}

/** The global app filter narrows the list; the API always answers for every app. */
export function visibleApps(
  health: IntegrationHealthDto | undefined,
  app: string | undefined,
): AppIntegrationHealthDto[] {
  const apps = health?.apps ?? [];
  return app ? apps.filter((entry) => entry.app === app) : apps;
}

function TallyGrid({ tally, loading }: { tally: HealthTally | null; loading: boolean }) {
  return (
    <section aria-label="Integration status" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiCard
        label="Healthy"
        icon={CheckCircle2}
        loading={loading}
        value={formatInteger(tally?.healthy)}
        hint="events in the last 24 h"
      />
      <KpiCard
        label="Stale"
        icon={Clock3}
        loading={loading}
        value={formatInteger(tally?.stale)}
        hint="nothing recent"
      />
      <KpiCard
        label="No events yet"
        icon={CircleDashed}
        loading={loading}
        value={formatInteger(tally?.never)}
        hint="registered, never sent"
      />
      <KpiCard
        label="Need attention"
        icon={TriangleAlert}
        loading={loading}
        value={formatInteger(tally?.needsAttention)}
        hint="apps with warnings"
      />
    </section>
  );
}

function CardsSkeleton() {
  return (
    <div className="grid gap-4 xl:grid-cols-2" aria-hidden="true">
      {[0, 1].map((index) => (
        <Card key={index} className="space-y-3 p-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-16 w-full" />
        </Card>
      ))}
    </div>
  );
}

/**
 * The Integration page: is each registered app actually sending? Per app — status, warnings with
 * the guide chapter that fixes them, last event and counters per source, SDK versions with clock
 * skew, the proxy-IP share and exposed keys. Teams land here from the guide's verify chapter.
 */
export function IntegrationView() {
  const { filters } = useGlobalFilters();
  const health = useIntegrationHealth();
  const apps = useMemo(() => visibleApps(health.data, filters.app), [health.data, filters.app]);
  const tally = health.data ? tallyHealth(apps) : null;
  const nowMs = health.data ? new Date(health.data.to).getTime() : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integration"
        description={
          health.data
            ? `Last ${WINDOW_HOURS} hours · checked ${formatDateTime(health.data.to)} IST`
            : 'Is every app sending, and what should its team fix?'
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <a href={guideHref('verify')} target="_blank" rel="noreferrer noopener">
                <ListChecks aria-hidden="true" />
                Verify steps
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={guideHref()} target="_blank" rel="noreferrer noopener">
                <BookOpen aria-hidden="true" />
                Integration guide
              </a>
            </Button>
          </>
        }
      />

      <TallyGrid tally={tally} loading={health.isPending} />

      <QueryState
        query={health}
        skeleton={<CardsSkeleton />}
        errorTitle="Could not load the integration status"
        isEmpty={apps.length === 0}
        empty={
          <Card>
            <EmptyState
              title={filters.app ? 'This app is not registered' : 'No apps registered yet'}
              description="An admin registers an app and issues its keys on the Apps page; its team then follows the integration guide."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href={PAGES.apps()}>Open Apps</Link>
                </Button>
              }
            />
          </Card>
        }
      >
        {() => (
          <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
            {apps.map((app) => (
              <AppHealthCard key={app.app} health={app} nowMs={nowMs} />
            ))}
          </div>
        )}
      </QueryState>
    </div>
  );
}
