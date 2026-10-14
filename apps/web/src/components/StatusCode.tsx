import { cn } from '@/lib/utils';

const SERVER_ERROR_MIN = 500;
const CLIENT_ERROR_MIN = 400;
const REDIRECT_MIN = 300;
const SUCCESS_MIN = 200;

/** The status class of a code: each class gets its own hue token (globals.css). */
export type StatusTone = 'server-error' | 'client-error' | 'success' | 'info';

/** WHY: one place maps a code to its class, so the pill and its tests agree on the boundaries. */
export function statusToneOf(status: number): StatusTone {
  if (status >= SERVER_ERROR_MIN) return 'server-error';
  if (status >= CLIENT_ERROR_MIN) return 'client-error';
  if (status >= SUCCESS_MIN && status < REDIRECT_MIN) return 'success';
  return 'info';
}

const TONE_CLASS: Record<StatusTone, string> = {
  'server-error': 'bg-destructive/12 text-destructive',
  'client-error': 'bg-warning/12 text-warning',
  success: 'bg-success/12 text-success',
  info: 'bg-info/12 text-info',
};

/**
 * WHY: 5xx (our fault), 4xx (caller's fault), 2xx (ok) and 1xx/3xx (informational/redirect) read
 * differently at a glance; the number stays the label, so colour is never the only signal.
 */
export function StatusCode({ status }: { status: number }) {
  const tone = statusToneOf(status);
  return (
    <span
      data-tone={tone}
      className={cn(
        'inline-flex h-5 min-w-10 items-center justify-center rounded-md px-1.5 font-mono text-2xs font-semibold',
        TONE_CLASS[tone],
      )}
    >
      {status}
    </span>
  );
}
