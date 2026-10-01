import type { RequestSampleDto } from '@nexus/shared';

import { ActorCell } from '@/components/ActorCell';
import type { DataTableColumn } from '@/components/DataTable';
import { MethodBadge } from '@/components/MethodBadge';
import { StatusCode } from '@/components/StatusCode';
import { EMPTY_VALUE, formatDateTime, formatDuration } from '@/lib/format';

/**
 * WHY: stored requests (failures on the Errors page, slowest calls on a route's page) read the
 * same way everywhere. The concrete path is shown as TEXT only — it is ingested data and never
 * becomes a link (ai-context/05-conventions.md §5); the IP shows only when the API sent one.
 */
export function requestSampleColumns(options: {
  showRoute: boolean;
}): DataTableColumn<RequestSampleDto>[] {
  const route: DataTableColumn<RequestSampleDto> = {
    id: 'request',
    header: 'Request',
    className: 'w-full max-w-0',
    cell: (row) => (
      <span className="flex min-w-0 items-center gap-2.5">
        <MethodBadge method={row.method} />
        <span className="min-w-0">
          <span className="block truncate font-mono text-xs" title={row.path}>
            {row.path}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {row.app} · {row.routeTemplate}
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
      cell: (row) => <ActorCell actor={row.actor} />,
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
