import type { RequestSampleDto } from '@nexus/shared';
import { PlayCircle } from 'lucide-react';
import Link from 'next/link';

import { ActorCell } from '@/components/ActorCell';
import { AppChip } from '@/components/AppChip';
import type { DataTableColumn } from '@/components/DataTable';
import { MethodBadge } from '@/components/MethodBadge';
import { StatusCode } from '@/components/StatusCode';
import { EMPTY_VALUE, formatDateTime, formatDuration } from '@/lib/format';
import { PAGES, withQuery } from '@/lib/pages';

type LinkQuery = Readonly<Record<string, string | undefined>>;

/**
 * WHY: stored requests (failures on the Errors page, slowest calls on a route's page) read the
 * same way everywhere, and every entity in a row leads somewhere: the route template opens the
 * route's page (opaque endpointId), the app its page, a verified user their profile (opaque
 * userKey) and a browser session its replay. The concrete path is shown as TEXT only — it is
 * ingested data and never becomes a link (ai-context/05-conventions.md §5); the IP shows only
 * when the API sent one.
 */
export function requestSampleColumns(options: {
  showRoute: boolean;
  /** The current filters, carried by every link (filterLinkQuery). */
  linkQuery: LinkQuery;
}): DataTableColumn<RequestSampleDto>[] {
  const { linkQuery } = options;
  const route: DataTableColumn<RequestSampleDto> = {
    id: 'request',
    header: 'Request',
    className: 'w-full max-w-0',
    cell: (row) => (
      <span className="flex min-w-0 items-center gap-2.5">
        <MethodBadge method={row.method} />
        <span className="min-w-0 space-y-1">
          <span className="block truncate font-mono text-xs" title={row.path}>
            {row.path}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <AppChip app={row.app} linkQuery={linkQuery} />
            <Link
              href={withQuery(PAGES.endpointDetail(row.endpointId), linkQuery)}
              className="truncate rounded-sm font-mono underline-offset-2 outline-none hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring/60"
              title="Open this route"
            >
              {row.routeTemplate}
            </Link>
          </span>
        </span>
      </span>
    ),
  };
  return [
    {
      id: 'time',
      header: 'Time (IST)',
      className: 'text-muted-foreground',
      cell: (row) => <time dateTime={row.occurredAt}>{formatDateTime(row.occurredAt)}</time>,
    },
    { id: 'status', header: 'Status', cell: (row) => <StatusCode status={row.status} /> },
    ...(options.showRoute ? [route] : []),
    {
      id: 'duration',
      header: 'Duration',
      align: 'right',
      cell: (row) => formatDuration(row.durationMs),
    },
    {
      id: 'actor',
      header: 'User',
      className: 'max-w-56',
      cell: (row) => (
        <span className="flex min-w-0 flex-col gap-1">
          <ActorCell actor={row.actor} linkQuery={linkQuery} />
          {row.sessionId ? (
            <Link
              href={withQuery(PAGES.sessionDetail(row.app, row.sessionId), linkQuery)}
              className="inline-flex w-fit items-center gap-1 rounded-sm text-[11px] text-muted-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <PlayCircle className="size-3" aria-hidden="true" />
              Open session
            </Link>
          ) : null}
        </span>
      ),
    },
    {
      id: 'ids',
      header: 'Error code / request id',
      className: 'max-w-56',
      cell: (row) => (
        <span className="flex min-w-0 flex-col gap-0.5 font-mono text-[11px]">
          <span className="truncate">{row.errorCode ?? EMPTY_VALUE}</span>
          <span className="truncate text-muted-foreground">{row.requestId ?? EMPTY_VALUE}</span>
        </span>
      ),
    },
  ];
}
