'use client';

import { ERROR_CODES } from '@nexus/shared';
import { AlertTriangle, CalendarRange, RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { ApiError } from '@/lib/apiError';
import { cn } from '@/lib/utils';

export interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  className?: string;
}

function describe(error: unknown): {
  message: string;
  code: string | null;
  requestId: string | null;
} {
  if (error instanceof ApiError) {
    return { message: error.message, code: error.code, requestId: error.requestId };
  }
  return {
    message: error instanceof Error ? error.message : 'Something went wrong.',
    code: null,
    requestId: null,
  };
}

/** The preset a too-long range falls back to (the longest one every page accepts). */
const SAFE_RANGE = '30d';

/** WHY: a range the page cannot cover is the user's choice, not a failure — offer the fix. */
function RangeTooLargeState({ className }: { className?: string }) {
  const { setRange } = useGlobalFilters();
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-6 py-10 text-center',
        className,
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
        <CalendarRange className="size-5" aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold">This range is too long for this view</p>
      <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
        Latency and time-on-page views cover at most 31 days. Pick a shorter range to see the data.
      </p>
      <Button variant="outline" size="sm" className="mt-2" onClick={() => setRange(SAFE_RANGE)}>
        Show the last 30 days
      </Button>
    </div>
  );
}

/**
 * WHY: a failed query explains itself — the API's message and code, plus the request id the user
 * can quote (it is in every api log line) — and offers a retry. A too-long range gets its own
 * friendly state with a one-click fix instead of an error.
 */
export function ErrorState({
  error,
  onRetry,
  title = 'Could not load this data',
  className,
}: ErrorStateProps) {
  const { message, code, requestId } = describe(error);
  if (code === ERROR_CODES.RANGE_TOO_LARGE) return <RangeTooLargeState className={className} />;
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-6 py-10 text-center',
        className,
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        <AlertTriangle className="size-5" aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold">{title}</p>
      <p className="max-w-md text-xs leading-relaxed text-muted-foreground">{message}</p>
      {code || requestId ? (
        <p className="font-mono text-2xs text-muted-foreground">
          {code ? <span>{code}</span> : null}
          {code && requestId ? <span aria-hidden="true"> · </span> : null}
          {requestId ? <span>Request ID {requestId}</span> : null}
        </p>
      ) : null}
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          <RotateCw aria-hidden="true" /> Try again
        </Button>
      ) : null}
    </div>
  );
}
