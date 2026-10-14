'use client';

import { EMPTY_VALUE, formatAgo, formatDateTime } from '@/lib/format';

/**
 * WHY: "4 min ago" is what people scan for freshness; the exact IST time is one hover away (and
 * in `dateTime` for screen readers and copy). Data arrives client-side, so `now` is the viewer's
 * clock at render — good enough for minutes-level freshness.
 */
export function RelativeTime({ iso, className }: { iso: string | null; className?: string }) {
  if (!iso) return <span className={className}>{EMPTY_VALUE}</span>;
  return (
    <time
      dateTime={iso}
      title={`${formatDateTime(iso)} IST`}
      className={className}
      suppressHydrationWarning
    >
      {formatAgo(iso, Date.now())}
    </time>
  );
}
