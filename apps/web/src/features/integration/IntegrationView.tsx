'use client';

import type { AppIntegrationHealthDto, IntegrationHealthDto } from '@nexus/shared';
import { ArrowUpRight, BookOpen, ListChecks, X } from 'lucide-react';
import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';

import { CheckRow } from '@/components/CheckRow';
import { CopyableText } from '@/components/CopyButton';
import { EmptyState } from '@/components/EmptyState';
import { HeadlineSentence } from '@/components/HeadlineSentence';
import { PageHeader } from '@/components/PageHeader';
import { QueryState } from '@/components/QueryState';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { formatDateTime } from '@/lib/format';
import { guideHref, type GuideChapter } from '@/lib/guide';
import { navLabel } from '@/lib/nav';
import { PAGES } from '@/lib/pages';

import { appCheckSummary, firstFix } from './appCheckSummary';
import { AppHealthBadges, AppHealthDetails, ViewTrafficLink } from './AppHealthCard';
import type { DashboardAccess } from './dashboardAccessCheck';
import { healthHeadline, WINDOW_HOURS, type HealthTally } from './healthHeadline';
import { HEALTH_MARK_COPY, healthMarkOf, orderByHealthMark } from './healthMark';
import { DASHBOARD_ACCESS_COPY } from './integrationCopy';
import { useIntegrationHealth } from './useIntegrationHealth';

export type { HealthTally } from './healthHeadline';

/** Headline counts of the visible apps (an app with any warning needs attention). */
export function tallyHealth(apps: readonly AppIntegrationHealthDto[]): HealthTally {
  return {
    healthy: apps.filter((app) => app.status === 'healthy').length,
    stale: apps.filter((app) => app.status === 'stale').length,
    never: apps.filter((app) => app.status === 'never').length,
    needsAttention: apps.filter((app) => app.warnings.length > 0).length,
    complete: apps.filter((app) => app.level === 'complete').length,
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

/** One checklist section: a Rajdhani h2 over its list of rows. */
function ChecklistSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="min-w-0 space-y-3">
      <h2 id={id} className="font-heading text-xl font-bold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** The platform check: who can open this dashboard, from the web server's DASHBOARD_* env. */
function DashboardAccessRow({ access }: { access: DashboardAccess }) {
  const copy = DASHBOARD_ACCESS_COPY[access];
  return (
    <CheckRow
      id="dashboard-access"
      state={copy.state}
      stateLabel={copy.stateLabel}
      title={<h3>Who can open this dashboard</h3>}
      summary={copy.summary}
      action={
        copy.action ? <span className="font-medium text-foreground">{copy.action}</span> : undefined
      }
    />
  );
}

/** External link to the guide chapter that fixes the row's first warning (named for screen readers). */
function HowToFixLink({ chapter, warningTitle }: { chapter: GuideChapter; warningTitle: string }) {
  return (
    <a
      href={guideHref(chapter)}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={`How to fix: ${warningTitle}`}
      className="inline-flex items-center gap-0.5 rounded-sm font-medium whitespace-nowrap text-link underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      How to fix
      <ArrowUpRight className="size-3" aria-hidden="true" />
    </a>
  );
}

/**
 * One app as a checklist row; "Show details" opens every block of its health card. The name is
 * the row's h3 (under the "Apps" h2) and the blocks are h4s, so moving by heading goes app by app.
 */
function AppCheckRow({
  health,
  nowMs,
  defaultOpen,
}: {
  health: AppIntegrationHealthDto;
  nowMs: number;
  defaultOpen: boolean;
}) {
  const state = healthMarkOf(health);
  const fix = firstFix(health);
  const summary = appCheckSummary(health);
  return (
    <CheckRow
      id={`app-check-${health.app}`}
      name={health.displayName}
      state={state}
      stateLabel={HEALTH_MARK_COPY[state]}
      title={
        <>
          <h3 className="min-w-0 break-words">{health.displayName}</h3>
          <span className="flex flex-wrap items-center gap-1.5 font-sans font-normal">
            <AppHealthBadges health={health} />
            <ViewTrafficLink app={health.app} />
          </span>
        </>
      }
      summary={summary}
      action={
        fix ? <HowToFixLink chapter={fix.chapter} warningTitle={fix.warningTitle} /> : undefined
      }
      defaultOpen={defaultOpen}
    >
      <div className="space-y-4">
        <p className="flex min-w-0 text-2xs text-muted-foreground">
          <CopyableText value={health.app} label="app slug" />
        </p>
        <AppHealthDetails health={health} nowMs={nowMs} headingAs="h4" />
      </div>
    </CheckRow>
  );
}

function RowsSkeleton() {
  return (
    <ul className="space-y-3" aria-hidden="true">
      {[0, 1].map((index) => (
        <li key={index} className="flex gap-3 rounded-xl bg-card p-4 ring-1 ring-border/60">
          <Skeleton className="size-4 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full max-w-md" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export interface IntegrationViewProps {
  /** Who can open the dashboard, folded on the server (app/(dashboard)/integration/page.tsx). */
  dashboardAccess: DashboardAccess;
}

/**
 * The Data health page as a checklist: is each registered app actually sending, and how deep is
 * the wiring? The counts read as one headline sentence; a Platform section checks who can open
 * the dashboard; then one row per app (needs action first) with its mark, a one-line summary and
 * "How to fix", whose "Show details" opens every block of the app's card — status and integration
 * level, warnings with the guide chapter that fixes them, last event and counters per source,
 * coverage, environments, releases, SDK versions with clock skew, redacted personal data,
 * rejection reasons, SSO cookie outcomes, the proxy-IP share and exposed keys. NOT
 * environment-filtered (it diagnoses staging wiring too). Teams land here from the guide's verify
 * chapter; an app's page links here narrowed to that app (`?app=`), and that row opens by itself.
 */
export function IntegrationView({ dashboardAccess }: IntegrationViewProps) {
  const { filters, setApp } = useGlobalFilters();
  const health = useIntegrationHealth();
  const apps = useMemo(() => visibleApps(health.data, filters.app), [health.data, filters.app]);
  const ordered = useMemo(() => orderByHealthMark(apps), [apps]);
  const nowMs = health.data ? new Date(health.data.to).getTime() : 0;
  const openRows = Boolean(filters.app) || apps.length === 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data health"
        description={
          health.data
            ? `Last ${WINDOW_HOURS} hours · checked ${formatDateTime(health.data.to)} IST`
            : 'Is every app sending, and what should its team fix?'
        }
        headline={
          health.data ? (
            <HeadlineSentence parts={healthHeadline(tallyHealth(apps), apps.length)} />
          ) : health.isPending ? (
            <Skeleton className="h-7 w-full max-w-xl" />
          ) : null
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

      <ChecklistSection id="checks-platform" title="Platform">
        <ul className="space-y-3">
          <DashboardAccessRow access={dashboardAccess} />
        </ul>
      </ChecklistSection>

      <ChecklistSection id="checks-apps" title="Apps">
        {filters.app ? (
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            Showing <span className="font-mono text-foreground">{filters.app}</span> only.
            <Button variant="ghost" size="sm" onClick={() => setApp(null)}>
              <X aria-hidden="true" />
              Show all apps
            </Button>
          </p>
        ) : null}

        <QueryState
          query={health}
          skeleton={<RowsSkeleton />}
          errorTitle="Could not load the integration status"
          isEmpty={apps.length === 0}
          empty={
            <Card>
              <EmptyState
                title={filters.app ? 'This app is not registered' : 'No apps registered yet'}
                description={`An admin registers an app and issues its keys on the ${navLabel('apps')} page. Its team then follows the integration guide.`}
                action={
                  <Button asChild variant="outline" size="sm">
                    <Link href={PAGES.apps()}>Open {navLabel('apps')}</Link>
                  </Button>
                }
              />
            </Card>
          }
        >
          {() => (
            <ul aria-label="App checks" className="space-y-3">
              {ordered.map((app) => (
                <AppCheckRow key={app.app} health={app} nowMs={nowMs} defaultOpen={openRows} />
              ))}
            </ul>
          )}
        </QueryState>
      </ChecklistSection>
    </div>
  );
}
