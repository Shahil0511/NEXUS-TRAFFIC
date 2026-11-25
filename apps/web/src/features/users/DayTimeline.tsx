import type { UserActivityBlockDto } from '@nexus/shared';

import { blockSegments } from './dailyActivity';

/** Hour labels under the timeline, in % of the day. */
const TIMELINE_TICKS = [
  { pct: 0, label: '00' },
  { pct: 25, label: '06' },
  { pct: 50, label: '12' },
  { pct: 75, label: '18' },
  { pct: 100, label: '24' },
] as const;

/**
 * WHY: the whole IST day 00:00-24:00 as one bar with one mark per activity block, so the reader
 * sees WHEN in the day the activity happened, in the DayStrip look. Decorative (aria-hidden): the
 * "Activity blocks" table right under it carries every start, end and length as text.
 */
export function DayTimeline({
  day,
  blocks,
}: {
  day: string;
  blocks: readonly UserActivityBlockDto[];
}) {
  const segments = blockSegments(day, blocks);
  return (
    <div aria-hidden="true" data-slot="day-timeline" className="space-y-1">
      <div className="relative h-4 w-full rounded-full bg-muted ring-1 ring-border ring-inset">
        {TIMELINE_TICKS.slice(1, -1).map((tick) => (
          <span
            key={tick.pct}
            className="absolute inset-y-0 w-px bg-border"
            style={{ left: `${tick.pct}%` }}
          />
        ))}
        {segments.map((segment) => (
          <span
            key={segment.key}
            data-testid="day-timeline-segment"
            className="absolute inset-y-0 rounded-full bg-primary"
            style={{ left: `${segment.startPct}%`, width: `${segment.widthPct}%` }}
          />
        ))}
      </div>
      <div className="relative h-4 text-2xs text-muted-foreground tabular">
        {TIMELINE_TICKS.map((tick) => (
          <span
            key={tick.pct}
            className="absolute -translate-x-1/2 first:translate-x-0 last:-translate-x-full"
            style={{ left: `${tick.pct}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
    </div>
  );
}
