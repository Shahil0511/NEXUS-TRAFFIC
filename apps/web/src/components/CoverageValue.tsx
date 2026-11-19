import { formatPercent } from '@/lib/format';
import { COVERAGE_WARN_PCT } from '@/lib/metricCopy';
import { cn } from '@/lib/utils';

export interface CoverageValueProps {
  /** Percentage 0..100, or null without enough data. */
  pct: number | null;
  /** What the share is OF, e.g. "of events carry a verified user" (title + accessible name). */
  meaning: string;
  /** Amber below this share (%); defaults to COVERAGE_WARN_PCT (release coverage uses its own). */
  warnBelowPct?: number;
  className?: string;
}

/**
 * WHY: a data-quality share — "96 %" (normal), amber below COVERAGE_WARN_PCT (the API's
 * COVERAGE_TARGET_RATIO), "—" without data. Used by the Applications table (both sources
 * combined) and the Integration page (per source), so both flag the same threshold the same way.
 * The meaning is in `title` + the accessible name, never colour alone.
 */
export function CoverageValue({
  pct,
  meaning,
  warnBelowPct = COVERAGE_WARN_PCT,
  className,
}: CoverageValueProps) {
  const low = pct !== null && pct < warnBelowPct;
  return (
    <span
      className={cn('tabular', low && 'font-semibold text-warning', className)}
      title={meaning}
      aria-label={`${formatPercent(pct, 0)} ${meaning}${low ? ' (low)' : ''}`}
    >
      {formatPercent(pct, 0)}
    </span>
  );
}
