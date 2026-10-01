'use client';

import { AlertTriangle, RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
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

/**
 * WHY: a failed query explains itself — the API's message and code, plus the request id the user
 * can quote (it is in every api log line) — and offers a retry.
 */
export function ErrorState({
  error,
  onRetry,
  title = 'Could not load this data',
  className,
}: ErrorStateProps) {
  const { message, code, requestId } = describe(error);
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
        <p className="font-mono text-[11px] text-muted-foreground">
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
