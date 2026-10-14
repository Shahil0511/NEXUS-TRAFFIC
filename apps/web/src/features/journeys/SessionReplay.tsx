'use client';

import type { SessionEventDto } from '@nexus/shared';
import { Hourglass, LogIn } from 'lucide-react';
import { useMemo } from 'react';

import { ActivityEventSummary, ActivityKindIcon } from '@/components/ActivityEvent';
import { Badge } from '@/components/ui/badge';
import { formatDateTime, formatDuration, formatElapsed } from '@/lib/format';
import { cn } from '@/lib/utils';

import { groupSessionSteps, type SessionStep } from './sessionSteps';

export interface SessionReplayProps {
  events: readonly SessionEventDto[];
  /** Session start (ISO) — every event shows its offset from it. */
  startedAt: string;
  /** The current filters; given → API calls link to their route's page. */
  linkQuery?: Readonly<Record<string, string | undefined>>;
}

/** "+1:05" since the session started, with the IST instant as the tooltip. */
function Offset({ occurredAt, startMs }: { occurredAt: string; startMs: number }) {
  return (
    <time
      dateTime={occurredAt}
      title={`${formatDateTime(occurredAt)} IST`}
      className="shrink-0 text-[11px] text-muted-foreground tabular"
    >
      {formatElapsed(Date.parse(occurredAt) - startMs)}
    </time>
  );
}

/**
 * WHY: a session read as a story — each page in order with the time it was actually visible, and
 * under it the tools used and the API calls it made. Every ingested value is rendered as text;
 * an API call additionally links to its route through the opaque endpointId.
 */
export function SessionReplay({ events, startedAt, linkQuery }: SessionReplayProps) {
  const steps = useMemo(() => groupSessionSteps(events), [events]);
  const startMs = Date.parse(startedAt);
  // A lead-in step (events before the first page view) has no number, so pages count from 1.
  const leadIn = steps[0]?.page === null ? 1 : 0;
  return (
    <ol aria-label="Session replay">
      {steps.map((step, index) => (
        <ReplayStep
          key={step.page?.eventId ?? 'lead-in'}
          step={step}
          pageNumber={step.page ? index + 1 - leadIn : null}
          isLast={index === steps.length - 1}
          startMs={startMs}
          linkQuery={linkQuery}
        />
      ))}
    </ol>
  );
}

interface ReplayStepProps {
  step: SessionStep;
  /** 1-based page number; null for the lead-in step without a page view. */
  pageNumber: number | null;
  isLast: boolean;
  startMs: number;
  linkQuery?: Readonly<Record<string, string | undefined>>;
}

function ReplayStep({ step, pageNumber, isLast, startMs, linkQuery }: ReplayStepProps) {
  const { page, events } = step;
  return (
    <li className={cn('relative grid grid-cols-[1.75rem_1fr] gap-x-3', !isLast && 'pb-5')}>
      {!isLast ? (
        <span
          aria-hidden="true"
          className="absolute top-8 bottom-1 left-[0.8125rem] w-px bg-border"
        />
      ) : null}
      <span
        className={cn(
          'flex size-7 items-center justify-center rounded-full text-[11px] font-semibold tabular',
          page ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground',
        )}
      >
        {pageNumber ?? <LogIn className="size-3.5" aria-hidden="true" />}
        <span className="sr-only">
          {page ? `Page ${pageNumber}` : 'Before the first page view'}
        </span>
      </span>
      <div className="min-w-0 space-y-2 pt-1">
        {page ? (
          <div className="flex min-w-0 items-center gap-3">
            <span className="min-w-0 truncate font-mono text-xs font-medium" title={page.path}>
              {page.path}
            </span>
            {page.visibleMs !== null ? (
              <Badge variant="muted" className="tabular">
                <Hourglass aria-hidden="true" />
                {formatDuration(page.visibleMs)} visible
              </Badge>
            ) : null}
            <span className="ml-auto">
              <Offset occurredAt={page.occurredAt} startMs={startMs} />
            </span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Before the first page view</p>
        )}
        {events.length > 0 ? (
          <ul className="space-y-1 rounded-lg bg-muted/50 p-2">
            {events.map((event) => (
              <li key={event.eventId} className="flex min-w-0 items-center gap-2 text-xs">
                <ActivityKindIcon kind={event.kind} />
                <span className="min-w-0 flex-1">
                  <ActivityEventSummary event={event} hidePagePath linkQuery={linkQuery} />
                </span>
                <Offset occurredAt={event.occurredAt} startMs={startMs} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}
