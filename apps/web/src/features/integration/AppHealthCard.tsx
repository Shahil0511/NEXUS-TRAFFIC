'use client';

import type {
  AppIntegrationHealthDto,
  IngestCounterDto,
  IngestSource,
  IntegrationStatus,
  IntegrationWarning,
  SdkHealthDto,
} from '@nexus/shared';
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  CircleDashed,
  Clock3,
  KeyRound,
  Monitor,
  Server,
  ShieldAlert,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';

import { CopyableText } from '@/components/CopyButton';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { InfoTip } from '@/components/InfoTip';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EMPTY_VALUE, formatDateTime, formatInteger, formatPercent } from '@/lib/format';
import { guideHref } from '@/lib/guide';
import { metricInfo } from '@/lib/metricCopy';
import { navLabel } from '@/lib/nav';
import { PAGES } from '@/lib/pages';
import { cn } from '@/lib/utils';

import { DEFAULT_BLOCK_HEADING, type BlockHeading } from './blockHeading';
import { CoverageStats } from './CoverageStats';
import { EnvironmentMix } from './EnvironmentMix';
import { IntegrationLevelBadge } from './IntegrationLevelBadge';
import {
  formatAgo,
  formatSkew,
  LEVEL_COPY,
  SOURCE_LABELS,
  STATUS_COPY,
  WARNING_COPY,
} from './integrationCopy';
import { PiiDetectionsTable } from './PiiDetectionsTable';
import { RejectionsTable } from './RejectionsTable';
import { ReleaseStatus } from './ReleaseStatus';
import { SsoOutcomes } from './SsoOutcomes';

const STATUS_ICONS: Record<IntegrationStatus, LucideIcon> = {
  healthy: CheckCircle2,
  stale: Clock3,
  never: CircleDashed,
};

const SOURCE_ICONS: Record<IngestSource, LucideIcon> = { server: Server, browser: Monitor };

const SDK_COLUMNS: DataTableColumn<SdkHealthDto>[] = [
  {
    id: 'sdk',
    header: 'SDK',
    className: 'w-full max-w-0',
    // The package name (split by the API at the last '@'); the raw label when unsplittable.
    cell: (row) => (
      <span className="block truncate font-mono text-xs" title={row.sdk ?? undefined}>
        {row.name ?? row.sdk ?? 'not announced'}
      </span>
    ),
  },
  {
    id: 'version',
    header: 'Version',
    cell: (row) => (
      <span className="font-mono text-xs whitespace-nowrap">{row.version ?? EMPTY_VALUE}</span>
    ),
  },
  {
    id: 'source',
    header: 'Source',
    cell: (row) => <span className="whitespace-nowrap">{SOURCE_LABELS[row.source]}</span>,
  },
  { id: 'events', header: 'Events', align: 'right', cell: (row) => formatInteger(row.events) },
  {
    id: 'skew',
    header: 'Median skew',
    align: 'right',
    cell: (row) => formatSkew(row.medianClockSkewMs),
  },
  {
    id: 'maxSkew',
    header: 'Worst',
    align: 'right',
    className: 'text-muted-foreground',
    cell: (row) => formatSkew(row.maxAbsClockSkewMs),
  },
];

/** One warning: what is wrong, what to do, and the guide chapter that explains the fix. */
function WarningItem({ code }: { code: IntegrationWarning }) {
  const copy = WARNING_COPY[code];
  const Icon = copy.tone === 'destructive' ? ShieldAlert : TriangleAlert;
  return (
    <li
      className={cn(
        'flex gap-3 rounded-lg p-3 ring-1 ring-inset',
        copy.tone === 'destructive'
          ? 'bg-destructive/8 ring-destructive/20'
          : 'bg-warning/8 ring-warning/20',
      )}
    >
      <Icon
        className={cn(
          'mt-0.5 size-4 shrink-0',
          copy.tone === 'destructive' ? 'text-destructive' : 'text-warning',
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 space-y-1">
        <p className="text-xs font-semibold">{copy.title}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{copy.description}</p>
        <a
          href={guideHref(copy.chapter)}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-0.5 text-xs font-medium text-link underline-offset-2 hover:underline"
        >
          How to fix
          <ArrowUpRight className="size-3" aria-hidden="true" />
        </a>
      </div>
    </li>
  );
}

const COUNTER_FIELDS: ReadonlyArray<{
  key: Exclude<keyof IngestCounterDto, 'source'>;
  label: string;
  bad: boolean;
}> = [
  { key: 'accepted', label: 'Accepted', bad: false },
  { key: 'duplicates', label: 'Duplicates', bad: false },
  { key: 'rejected', label: 'Rejected', bad: true },
  { key: 'rateLimited', label: 'Rate limited', bad: true },
];

/** Last event + the window's counters of one source. */
function SourceStats({
  counter,
  lastEventAt,
  nowMs,
  headingAs: Heading,
}: {
  counter: IngestCounterDto;
  lastEventAt: string | null;
  nowMs: number;
  headingAs: BlockHeading;
}) {
  const Icon = SOURCE_ICONS[counter.source];
  const ago = formatAgo(lastEventAt, nowMs);
  return (
    <section
      aria-label={`${SOURCE_LABELS[counter.source]} events`}
      className="space-y-3 rounded-lg bg-muted/40 p-3 ring-1 ring-border/60 ring-inset"
    >
      <div className="flex items-start justify-between gap-2">
        <Heading className="flex items-center gap-1.5 text-xs font-semibold">
          <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
          {SOURCE_LABELS[counter.source]}
        </Heading>
        <p className="text-right text-2xs text-muted-foreground">
          {lastEventAt ? (
            <>
              <time dateTime={lastEventAt}>{formatDateTime(lastEventAt)}</time>
              <span className="block">{ago}</span>
            </>
          ) : (
            'never'
          )}
        </p>
      </div>
      <dl className="grid grid-cols-4 gap-2">
        {COUNTER_FIELDS.map((field) => {
          const value = counter[field.key];
          return (
            <div key={field.key} className="min-w-0">
              <dt className="truncate text-2xs text-muted-foreground">{field.label}</dt>
              <dd
                className={cn(
                  'text-sm font-semibold tabular',
                  field.bad && value > 0 && 'text-destructive',
                )}
              >
                {formatInteger(value)}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

export interface AppHealthCardProps {
  health: AppIntegrationHealthDto;
  /** "Now" of the page render, for the "x min ago" labels. */
  nowMs: number;
}

export interface AppHealthDetailsProps extends AppHealthCardProps {
  /** The block headings' level: one below the app's name (h3 under a card title, h4 in a row). */
  headingAs?: BlockHeading;
}

/** The level's meaning and what the next level needs, with the (i) explaining levels. */
function LevelLine({ health }: { health: AppIntegrationHealthDto }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <span>
        <span className="font-medium text-foreground">{LEVEL_COPY[health.level].label}:</span>{' '}
        {LEVEL_COPY[health.level].description}
      </span>
      <InfoTip label="Integration level" text={metricInfo('integrationLevel')} />
    </p>
  );
}

/**
 * WHY: everything a team needs to know about ONE app's wiring, without a frame — integration
 * level, what to fix (with the guide chapter), per-source last event and counters, coverage
 * (identified per source, linked calls), environments, releases, SDKs with version and clock
 * skew, redacted personal data, rejection reasons, SSO cookie outcomes, the proxy-IP share and
 * exposed keys. Shared by the card (AppHealthCard) and the Data health checklist row
 * (IntegrationView, "Show details"); `headingAs` keeps the block headings one level below the
 * app's name in either place. The tables bleed 1rem left and right (`-mx-4`): the parent
 * MUST pad 1rem (CardContent, the CheckRow body). Strings from the API render as text only,
 * never as href/src.
 */
export function AppHealthDetails({
  health,
  nowMs,
  headingAs = DEFAULT_BLOCK_HEADING,
}: AppHealthDetailsProps) {
  const lastBySource: Record<IngestSource, string | null> = {
    server: health.lastServerEventAt,
    browser: health.lastBrowserEventAt,
  };

  return (
    <div className="space-y-4">
      <LevelLine health={health} />
      {health.warnings.length > 0 ? (
        <ul aria-label={`Warnings for ${health.displayName}`} className="space-y-2">
          {health.warnings.map((code) => (
            <WarningItem key={code} code={code} />
          ))}
        </ul>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {health.counters.map((counter) => (
          <SourceStats
            key={counter.source}
            counter={counter}
            lastEventAt={lastBySource[counter.source]}
            nowMs={nowMs}
            headingAs={headingAs}
          />
        ))}
      </div>

      <div className="grid gap-4 rounded-lg p-3 ring-1 ring-border/60 ring-inset sm:grid-cols-2">
        <CoverageStats
          identityCoverage={health.identityCoverage}
          linkingCoverage={health.linkingCoverage}
          headingAs={headingAs}
        />
        <div className="space-y-4">
          <EnvironmentMix environments={health.environments} headingAs={headingAs} />
          <ReleaseStatus releases={health.releases} headingAs={headingAs} />
        </div>
      </div>

      {health.piiDetections.length > 0 ? (
        <div className="-mx-4">
          <PiiDetectionsTable detections={health.piiDetections} appName={health.displayName} />
        </div>
      ) : null}

      {health.rejections.length > 0 ? (
        <div className="-mx-4">
          <RejectionsTable rejections={health.rejections} appName={health.displayName} />
        </div>
      ) : null}

      {health.ssoCookieOutcomes.length > 0 ? (
        <SsoOutcomes
          outcomes={health.ssoCookieOutcomes}
          appName={health.displayName}
          headingAs={headingAs}
        />
      ) : null}

      <div className="-mx-4">
        <DataTable
          caption={`SDKs of ${health.displayName}`}
          columns={SDK_COLUMNS}
          rows={health.sdks}
          rowKey={(row) => `${row.source}|${row.sdk ?? ''}`}
          skeletonRows={1}
          empty={
            <EmptyState
              className="py-5"
              title="No SDK seen in the last 24 hours"
              description="SDK versions and clock skew appear once events arrive."
            />
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span>
          Private IPs:{' '}
          <span className="font-medium text-foreground tabular">
            {health.privateIpRatio === null
              ? 'not enough data'
              : `${formatPercent(health.privateIpRatio * 100, 0)} of server events`}
          </span>
          {health.warnings.includes('private_ips') ? (
            <span className="text-foreground"> · Places stay empty</span>
          ) : null}
        </span>
        {health.exposedKeys.length > 0 ? (
          <Link
            href={PAGES.apps()}
            className="inline-flex items-center gap-1 rounded-sm font-medium text-destructive underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <KeyRound className="size-3.5" aria-hidden="true" />
            Rotate {health.exposedKeys.map((key) => key.keyPrefix).join(', ')} on the{' '}
            {navLabel('apps')} page
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/**
 * WHY: one look for "is this app switched on, how deep is it wired, is it sending" wherever an
 * app's health is headed (the card header, the Data health row title): disabled, level, status.
 */
export function AppHealthBadges({ health }: { health: AppIntegrationHealthDto }) {
  const status = STATUS_COPY[health.status];
  const StatusIcon = STATUS_ICONS[health.status];
  return (
    <>
      {health.isActive ? null : <Badge variant="destructive">disabled</Badge>}
      <IntegrationLevelBadge level={health.level} />
      <Badge variant={status.tone}>
        <StatusIcon aria-hidden="true" />
        {status.label}
      </Badge>
    </>
  );
}

/** WHY: from an app's health to its traffic (the App page) in one click, beside its name. */
export function ViewTrafficLink({ app }: { app: string }) {
  return (
    <Link
      href={PAGES.applicationDetail(app)}
      className="inline-flex items-center gap-1 rounded-sm text-xs font-medium whitespace-nowrap text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      View traffic
      <ArrowRight className="size-3" aria-hidden="true" />
    </Link>
  );
}

/**
 * WHY: ONE app's wiring on one card — the header (name, copyable slug, View traffic, disabled /
 * level / status badges) over AppHealthDetails. Kept for the App page's Health tab; the Data
 * health page shows the same details inside a checklist row instead.
 */
export function AppHealthCard({ health, nowMs }: AppHealthCardProps) {
  const headingId = `app-health-${health.app}`;

  return (
    <Card aria-labelledby={headingId}>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle id={headingId} className="truncate">
            {health.displayName}
          </CardTitle>
          <p className="mt-0.5 flex min-w-0 text-2xs text-muted-foreground">
            <CopyableText value={health.app} label="app slug" />
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <ViewTrafficLink app={health.app} />
          <AppHealthBadges health={health} />
        </div>
      </CardHeader>
      <CardContent>
        <AppHealthDetails health={health} nowMs={nowMs} />
      </CardContent>
    </Card>
  );
}
