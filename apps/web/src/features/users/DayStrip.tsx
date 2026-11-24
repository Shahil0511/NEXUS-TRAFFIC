import { dayStripSpan } from './dailyActivity';

/** Hour marks drawn on the strip (06:00, 12:00, 18:00), in % of the day. */
const STRIP_TICKS_PCT = [25, 50, 75] as const;

/**
 * WHY: a whole IST day as one bar, so the reader sees at a glance WHEN in the day the activity
 * happened. Only the span first → last activity is marked (not what happened in between).
 * Decorative (aria-hidden): the times are printed as text right above it, so a label here only
 * read them twice (and lost the "so far" of today's row).
 */
export function DayStrip({
  day,
  firstAt,
  lastAt,
}: {
  day: string;
  firstAt: string;
  lastAt: string;
}) {
  const span = dayStripSpan(day, firstAt, lastAt);
  return (
    <div
      aria-hidden="true"
      data-slot="day-strip"
      className="relative h-3 w-full rounded-full bg-muted ring-1 ring-border ring-inset"
    >
      {STRIP_TICKS_PCT.map((tick) => (
        <span
          key={tick}
          aria-hidden="true"
          className="absolute inset-y-0 w-px bg-border"
          style={{ left: `${tick}%` }}
        />
      ))}
      <span
        aria-hidden="true"
        data-testid="day-strip-span"
        className="absolute inset-y-0 rounded-full bg-primary"
        style={{ left: `${span.startPct}%`, width: `${span.widthPct}%` }}
      />
    </div>
  );
}
