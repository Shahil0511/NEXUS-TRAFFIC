import type { AppTrafficDto, MetricDto } from '@nexus/shared';
import Link from 'next/link';
import type { ReactNode } from 'react';

import type { DataTableColumn } from '@/components/DataTable';
import { DeltaPill, type DeltaPolarity } from '@/components/KpiCard';
import { Badge } from '@/components/ui/badge';
import {
  EMPTY_VALUE,
  formatCompact,
  formatDuration,
  formatInteger,
  formatPercent,
} from '@/lib/format';
import { COVERAGE_WARN_PCT, metricInfo } from '@/lib/metricCopy';
import { PAGES, withQuery } from '@/lib/pages';

type LinkQuery = Readonly<Record<string, string | undefined>>;

/** A number with its change versus the previous window, right-aligned in a table cell. */
function MetricCell({
  metric,
  format,
  polarity = 'up-is-good',
}: {
  metric: MetricDto;
  format: (value: number | null) => string;
  polarity?: DeltaPolarity;
}) {
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span className="tabular">{format(metric.value)}</span>
      {metric.deltaPct !== null ? (
        <DeltaPill deltaPct={metric.deltaPct} polarity={polarity} />
      ) : null}
    </span>
  );
}

/**
 * A data-quality share: "96 %" (normal), amber below COVERAGE_WARN_PCT, "—" without data.
 * The meaning is in `title` + the accessible name, never colour alone.
 */
function CoverageCell({ pct, meaning }: { pct: number | null; meaning: string }) {
  const low = pct !== null && pct < COVERAGE_WARN_PCT;
  return (
    <span
      className={low ? 'font-semibold text-warning tabular' : 'tabular'}
      title={meaning}
      aria-label={`${formatPercent(pct, 0)} ${meaning}${low ? ' (low)' : ''}`}
    >
      {formatPercent(pct, 0)}
    </span>
  );
}

/**
 * People active in the app right now (verified + anonymous): a green dot and the number, "—" for
 * nobody or while unknown. The dot is decorative; the (screen-reader) words carry the meaning
 * — an aria-label on a plain span is not announced.
 */
function OnlineNowCell({ count }: { count: number | undefined }) {
  if (!count) return <span className="text-muted-foreground">{EMPTY_VALUE}</span>;
  return (
    <span className="inline-flex items-center gap-1.5 tabular">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
      {formatInteger(count)}
      <span className="sr-only"> online now</span>
    </span>
  );
}

/** Whether an app sent nothing at all in the window (a silent integration). */
export function isSilent(row: AppTrafficDto): boolean {
  return row.lastEventAt === null;
}

/**
 * WHY: the Applications table — every app on one line with the numbers a lead compares (people,
 * traffic, failures, speed, adoption). Each app opens its own page (PAGES.applicationDetail; the
 * registered slug, never ingested text) and every number has its previous-window change. Every
 * metric header carries an (i) with its plain-language definition (lib/metricCopy) — that is
 * where "Identified" / "Linked" and their COVERAGE_WARN_PCT threshold are explained.
 * "Online now" ignores the range: `onlineOf(app)` comes from useOnlineNow (features/live), merged
 * by app slug in the view.
 */
export function appTrafficColumns(
  linkQuery: LinkQuery,
  formatLastEvent: (iso: string | null) => ReactNode,
  onlineOf: (app: string) => number | undefined,
): DataTableColumn<AppTrafficDto>[] {
  return [
    {
      id: 'app',
      header: 'Application',
      className: 'w-full max-w-0',
      cell: (row) => (
        <Link
          href={withQuery(PAGES.applicationDetail(row.app), { ...linkQuery, app: undefined })}
          className="flex min-w-0 items-center gap-2.5 rounded-sm outline-none hover:text-link focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-xs font-semibold text-accent-foreground uppercase"
          >
            {row.displayName.slice(0, 2)}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate font-medium">{row.displayName}</span>
              {isSilent(row) ? <Badge variant="muted">no data</Badge> : null}
            </span>
            <span className="block truncate font-mono text-2xs text-muted-foreground">
              {row.app}
            </span>
          </span>
        </Link>
      ),
    },
    {
      id: 'onlineNow',
      header: 'Online now',
      hint: metricInfo('onlineNow'),
      align: 'right',
      className: 'whitespace-nowrap',
      cell: (row) => <OnlineNowCell count={onlineOf(row.app)} />,
    },
    {
      id: 'users',
      header: 'Users',
      hint: metricInfo('uniqueUsers'),
      align: 'right',
      cell: (row) => <MetricCell metric={row.users} format={formatInteger} />,
    },
    {
      id: 'requests',
      header: 'API calls',
      hint: metricInfo('requests'),
      align: 'right',
      cell: (row) => <MetricCell metric={row.requests} format={formatCompact} />,
    },
    {
      id: 'errorRate',
      header: 'Error rate',
      hint: metricInfo('errorRate'),
      align: 'right',
      cell: (row) => (
        <MetricCell metric={row.errorRate} format={formatPercent} polarity="down-is-good" />
      ),
    },
    {
      id: 'p95',
      header: 'p95',
      hint: metricInfo('p95'),
      align: 'right',
      cell: (row) => <span className="tabular">{formatDuration(row.p95Ms)}</span>,
    },
    {
      id: 'pageViews',
      header: 'Page views',
      hint: metricInfo('pageViews'),
      align: 'right',
      cell: (row) => <MetricCell metric={row.pageViews} format={formatCompact} />,
    },
    {
      id: 'sessions',
      header: 'Sessions',
      hint: metricInfo('sessions'),
      align: 'right',
      cell: (row) => <span className="tabular">{formatInteger(row.sessions)}</span>,
    },
    {
      id: 'toolUses',
      header: 'Tool uses',
      hint: metricInfo('toolUses'),
      align: 'right',
      cell: (row) => <span className="tabular">{formatInteger(row.toolUses)}</span>,
    },
    {
      id: 'identified',
      header: 'Identified',
      hint: metricInfo('identifiedPct'),
      align: 'right',
      cell: (row) => (
        <CoverageCell pct={row.identifiedPct} meaning="of events carry a verified user" />
      ),
    },
    {
      id: 'linked',
      header: 'Linked',
      hint: metricInfo('linkedPct'),
      align: 'right',
      cell: (row) => (
        <CoverageCell pct={row.linkedPct} meaning="of API calls are linked to a browser session" />
      ),
    },
    {
      id: 'lastEvent',
      header: 'Last event',
      align: 'right',
      className: 'whitespace-nowrap text-muted-foreground',
      cell: (row) => formatLastEvent(row.lastEventAt),
    },
  ];
}
