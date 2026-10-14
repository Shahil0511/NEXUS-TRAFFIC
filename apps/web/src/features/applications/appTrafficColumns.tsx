import type { AppTrafficDto, MetricDto } from '@nexus/shared';
import Link from 'next/link';
import type { ReactNode } from 'react';

import type { DataTableColumn } from '@/components/DataTable';
import { DeltaPill, type DeltaPolarity } from '@/components/KpiCard';
import { Badge } from '@/components/ui/badge';
import { formatCompact, formatDuration, formatInteger, formatPercent } from '@/lib/format';
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

/** Whether an app sent nothing at all in the window (a silent integration). */
export function isSilent(row: AppTrafficDto): boolean {
  return row.lastEventAt === null;
}

/**
 * WHY: the Applications table — every app on one line with the numbers a lead compares (people,
 * traffic, failures, speed, adoption). Each app opens its own page (PAGES.applicationDetail; the
 * registered slug, never ingested text) and every number has its previous-window change.
 */
export function appTrafficColumns(
  linkQuery: LinkQuery,
  formatLastEvent: (iso: string | null) => ReactNode,
): DataTableColumn<AppTrafficDto>[] {
  return [
    {
      id: 'app',
      header: 'Application',
      className: 'w-full max-w-0',
      cell: (row) => (
        <Link
          href={withQuery(PAGES.applicationDetail(row.app), { ...linkQuery, app: undefined })}
          className="flex min-w-0 items-center gap-2.5 rounded-sm outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/60"
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
            <span className="block truncate font-mono text-[11px] text-muted-foreground">
              {row.app}
            </span>
          </span>
        </Link>
      ),
    },
    {
      id: 'users',
      header: 'Users',
      align: 'right',
      cell: (row) => <MetricCell metric={row.users} format={formatInteger} />,
    },
    {
      id: 'requests',
      header: 'API calls',
      align: 'right',
      cell: (row) => <MetricCell metric={row.requests} format={formatCompact} />,
    },
    {
      id: 'errorRate',
      header: 'Error rate',
      align: 'right',
      cell: (row) => (
        <MetricCell metric={row.errorRate} format={formatPercent} polarity="down-is-good" />
      ),
    },
    {
      id: 'p95',
      header: 'p95',
      align: 'right',
      cell: (row) => <span className="tabular">{formatDuration(row.p95Ms)}</span>,
    },
    {
      id: 'pageViews',
      header: 'Page views',
      align: 'right',
      cell: (row) => <MetricCell metric={row.pageViews} format={formatCompact} />,
    },
    {
      id: 'sessions',
      header: 'Sessions',
      align: 'right',
      cell: (row) => <span className="tabular">{formatInteger(row.sessions)}</span>,
    },
    {
      id: 'toolUses',
      header: 'Tool uses',
      align: 'right',
      cell: (row) => <span className="tabular">{formatInteger(row.toolUses)}</span>,
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
