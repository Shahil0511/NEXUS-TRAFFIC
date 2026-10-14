import {
  HTTP_METHOD_VALUES,
  type HttpMethod,
  type TimelineItemDto,
  type TimelineItemKind,
} from '@nexus/shared';
import {
  ArrowLeftRight,
  ArrowUpRight,
  FileText,
  Hourglass,
  MousePointerClick,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';

import { MethodBadge } from '@/components/MethodBadge';
import { StatusCode } from '@/components/StatusCode';
import { formatDuration } from '@/lib/format';
import { PAGES, withQuery } from '@/lib/pages';
import { cn } from '@/lib/utils';

/**
 * The fields a user-timeline item (TimelineItemDto) and a session-replay step (SessionEventDto)
 * share — both render through the components below.
 */
export type ActivityEventLike = Pick<
  TimelineItemDto,
  | 'kind'
  | 'path'
  | 'tool'
  | 'visibleMs'
  | 'name'
  | 'method'
  | 'status'
  | 'durationMs'
  | 'endpointId'
>;

export const ACTIVITY_KIND_META: Record<TimelineItemKind, { label: string; icon: LucideIcon }> = {
  api: { label: 'API call', icon: ArrowLeftRight },
  page_view: { label: 'Page view', icon: FileText },
  page_time: { label: 'Time on page', icon: Hourglass },
  tool_use: { label: 'Tool', icon: MousePointerClick },
  custom: { label: 'Event', icon: Sparkles },
};

const KIND_TONE: Record<TimelineItemKind, string> = {
  api: 'bg-muted text-muted-foreground',
  page_view: 'bg-accent text-accent-foreground',
  page_time: 'bg-accent text-accent-foreground',
  tool_use: 'bg-primary/12 text-primary',
  custom: 'bg-muted text-muted-foreground',
};

function isHttpMethod(method: string | null): method is HttpMethod {
  return method !== null && (HTTP_METHOD_VALUES as readonly string[]).includes(method);
}

/** WHY: the kind of a timeline row is scanned first; icon + label, never colour alone. */
export function ActivityKindBadge({ kind }: { kind: TimelineItemKind }) {
  const { label, icon: Icon } = ACTIVITY_KIND_META[kind];
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-2xs font-semibold whitespace-nowrap',
        KIND_TONE[kind],
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {label}
    </span>
  );
}

/** Round icon used by the session replay's nested steps. */
export function ActivityKindIcon({ kind }: { kind: TimelineItemKind }) {
  const { label, icon: Icon } = ACTIVITY_KIND_META[kind];
  return (
    <span
      className={cn('flex size-5 shrink-0 items-center justify-center rounded-md', KIND_TONE[kind])}
      title={label}
    >
      <Icon className="size-3" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function PathText({ path }: { path: string }) {
  return (
    <span className="min-w-0 truncate font-mono text-xs" title={path}>
      {path}
    </span>
  );
}

/**
 * WHY: one line that says what happened — the API call with its verb, status and duration, the
 * page with its visible time, the tool used on a page, or a custom event. Paths, tool and event
 * names are ingested data: rendered as TEXT, never as links (ai-context/05-conventions.md §5);
 * an API call gets a separate "route" link built from its OPAQUE endpointId.
 */
export function ActivityEventSummary({
  event,
  hidePagePath = false,
  linkQuery,
}: {
  event: ActivityEventLike;
  /** In a session replay a tool/custom event sits under its page already: skip "on /path". */
  hidePagePath?: boolean;
  /** The current filters; given → API calls link to their route's page. */
  linkQuery?: Readonly<Record<string, string | undefined>>;
}) {
  const onPage = hidePagePath ? null : (
    <>
      <span className="shrink-0 text-2xs text-muted-foreground">on</span>
      <PathText path={event.path} />
    </>
  );
  switch (event.kind) {
    case 'api':
      return (
        <span className="flex min-w-0 items-center gap-2">
          {isHttpMethod(event.method) ? (
            <MethodBadge method={event.method} />
          ) : (
            <span className="font-mono text-2xs text-muted-foreground">{event.method}</span>
          )}
          <PathText path={event.path} />
          {event.status !== null ? <StatusCode status={event.status} /> : null}
          {event.durationMs !== null ? (
            <span className="shrink-0 text-2xs text-muted-foreground tabular">
              {formatDuration(event.durationMs)}
            </span>
          ) : null}
          {event.endpointId && linkQuery ? (
            <Link
              href={withQuery(PAGES.endpointDetail(event.endpointId), linkQuery)}
              className="inline-flex shrink-0 items-center gap-0.5 rounded-sm text-2xs text-muted-foreground outline-none hover:text-link focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              Route
              <ArrowUpRight className="size-3" aria-hidden="true" />
              <span className="sr-only"> details for this call</span>
            </Link>
          ) : null}
        </span>
      );
    case 'tool_use':
      return (
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-medium">{event.tool ?? 'Unnamed tool'}</span>
          {onPage}
        </span>
      );
    case 'custom':
      return (
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-medium">{event.name ?? 'Custom event'}</span>
          {onPage}
        </span>
      );
    default:
      return (
        <span className="flex min-w-0 items-center gap-2">
          <PathText path={event.path} />
          {event.visibleMs !== null ? (
            <span className="shrink-0 text-2xs text-muted-foreground tabular">
              {formatDuration(event.visibleMs)} visible
            </span>
          ) : null}
        </span>
      );
  }
}
