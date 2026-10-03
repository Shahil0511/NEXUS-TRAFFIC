import type { TimelineItemDto, TimeWindowQuery } from '@nexus/shared';
import { PlayCircle } from 'lucide-react';
import Link from 'next/link';

import { ActivityEventSummary, ActivityKindBadge } from '@/components/ActivityEvent';
import type { DataTableColumn } from '@/components/DataTable';
import { filterLinkQuery } from '@/features/filters/useGlobalFilters';
import { EMPTY_VALUE, formatDateTime } from '@/lib/format';
import { PAGES, withQuery } from '@/lib/pages';

/** Characters of the session uuid read out in a link's accessible name. */
const SESSION_ID_PREVIEW = 8;

/**
 * WHY: a user's combined timeline reads as one table — when, what kind, what exactly, where.
 * The replay link is built ONLY from the app slug + session uuid (PAGES); paths are text.
 * The IP shows only when the API sent one (admins).
 */
export function userTimelineColumns(filters: TimeWindowQuery): DataTableColumn<TimelineItemDto>[] {
  const linkQuery = filterLinkQuery(filters);
  return [
    {
      id: 'time',
      header: 'Time (IST)',
      className: 'text-muted-foreground',
      cell: (row) => <time dateTime={row.occurredAt}>{formatDateTime(row.occurredAt)}</time>,
    },
    { id: 'kind', header: 'Event', cell: (row) => <ActivityKindBadge kind={row.kind} /> },
    {
      id: 'detail',
      header: 'Detail',
      className: 'w-full max-w-0',
      cell: (row) => <ActivityEventSummary event={row} />,
    },
    {
      id: 'app',
      header: 'App',
      className: 'max-w-44',
      cell: (row) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate">{row.app}</span>
          {row.ip ? (
            <span className="truncate font-mono text-[11px] text-muted-foreground">{row.ip}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'session',
      header: 'Session',
      cell: (row) =>
        row.sessionId ? (
          <Link
            href={withQuery(PAGES.sessionDetail(row.app, row.sessionId), linkQuery)}
            className="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <PlayCircle className="size-3.5" aria-hidden="true" />
            Replay
            <span className="sr-only"> session {row.sessionId.slice(0, SESSION_ID_PREVIEW)}</span>
          </Link>
        ) : (
          <span className="text-muted-foreground">{EMPTY_VALUE}</span>
        ),
    },
  ];
}
