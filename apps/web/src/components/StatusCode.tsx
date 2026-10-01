import { cn } from '@/lib/utils';

const SERVER_ERROR_MIN = 500;
const CLIENT_ERROR_MIN = 400;

/** WHY: 5xx (our fault) and 4xx (caller's fault) read differently at a glance; the number stays the label. */
export function StatusCode({ status }: { status: number }) {
  const tone =
    status >= SERVER_ERROR_MIN
      ? 'bg-destructive/12 text-destructive'
      : status >= CLIENT_ERROR_MIN
        ? 'bg-warning/12 text-warning'
        : 'bg-success/12 text-success';
  return (
    <span
      className={cn(
        'inline-flex h-5 min-w-10 items-center justify-center rounded-md px-1.5 font-mono text-[11px] font-semibold',
        tone,
      )}
    >
      {status}
    </span>
  );
}
