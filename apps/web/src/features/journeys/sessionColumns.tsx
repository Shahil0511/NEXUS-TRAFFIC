import type { SessionSummaryDto, TimeWindowQuery } from '@nexus/shared';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { ActorCell } from '@/components/ActorCell';
import type { DataTableColumn } from '@/components/DataTable';
import { filterLinkQuery } from '@/features/filters/useGlobalFilters';
import { EMPTY_VALUE, formatDateTime, formatDuration, formatInteger } from '@/lib/format';
import { PAGES, withQuery } from '@/lib/pages';

import { sessionActor } from './sessionSteps';

/**
 * WHY: one row per browser session — when, where it entered and left, who (verified, a flagged
 * claim, or anonymous; IP for admins only) and how much happened. The replay link is built ONLY
 * from the app slug + session uuid (PAGES); entry/exit paths are text inside it.
 */
export function sessionColumns(filters: TimeWindowQuery): DataTableColumn<SessionSummaryDto>[] {
  const linkQuery = filterLinkQuery(filters);
  return [
    {
      id: 'started',
      header: 'Started (IST)',
      className: 'text-muted-foreground',
      cell: (row) => <time dateTime={row.startedAt}>{formatDateTime(row.startedAt)}</time>,
    },
    {
      id: 'journey',
      header: 'Journey',
      className: 'w-full max-w-0',
      cell: (row) => (
        <Link
          href={withQuery(PAGES.sessionDetail(row.app, row.sessionId), linkQuery)}
          className="flex min-w-0 flex-col gap-0.5 rounded-sm outline-none hover:text-link focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <span className="flex min-w-0 items-center gap-1.5 font-mono text-xs">
            <span className="min-w-0 truncate">{row.entryPath ?? EMPTY_VALUE}</span>
            {row.exitPath && row.exitPath !== row.entryPath ? (
              <>
                <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">to</span>
                <span className="min-w-0 truncate">{row.exitPath}</span>
              </>
            ) : null}
          </span>
          <span className="truncate text-2xs text-muted-foreground">{row.app}</span>
        </Link>
      ),
    },
    {
      id: 'user',
      header: 'User',
      className: 'max-w-56',
      cell: (row) => <ActorCell actor={sessionActor(row)} linkQuery={linkQuery} />,
    },
    {
      id: 'pageViews',
      header: 'Pages',
      align: 'right',
      cell: (row) => formatInteger(row.pageViews),
    },
    {
      id: 'toolUses',
      header: 'Tools',
      align: 'right',
      cell: (row) => formatInteger(row.toolUses),
    },
    {
      id: 'visible',
      header: 'Visible',
      align: 'right',
      cell: (row) => formatDuration(row.visibleMs),
    },
    {
      id: 'duration',
      header: 'Duration',
      align: 'right',
      cell: (row) => formatDuration(row.durationMs),
    },
  ];
}
