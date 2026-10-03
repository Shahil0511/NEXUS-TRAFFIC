'use client';

import { AlertTriangle } from 'lucide-react';

import { ApiError } from '@/lib/apiError';

/**
 * WHY: a failed mutation inside a dialog explains itself in place (the API's message, code and
 * request id) without replacing the form the user is filling in.
 */
export function InlineError({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  const detail =
    error instanceof ApiError
      ? [error.code, error.requestId ? `Request ID ${error.requestId}` : null]
          .filter(Boolean)
          .join(' · ')
      : null;
  return (
    <div
      role="alert"
      className="flex gap-2 rounded-lg bg-destructive/8 px-3 py-2 text-xs text-destructive ring-1 ring-destructive/20 ring-inset"
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p>{message}</p>
        {detail ? <p className="font-mono text-[11px] opacity-80">{detail}</p> : null}
      </div>
    </div>
  );
}
