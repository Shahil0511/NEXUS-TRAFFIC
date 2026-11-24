'use client';

import type { UserDayActivityDto } from '@nexus/shared';
import { useId, useState } from 'react';

import { AppChip } from '@/components/AppChip';

import { appClockSpan, appTimeLabel, visibleAppLines } from './dailyActivity';

type LinkQuery = Readonly<Record<string, string | undefined>>;

const MORE_BUTTON_CLASS =
  'rounded-sm text-2xs font-medium text-link underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60';

/**
 * WHY: one line per app the person used that day, in the order the apps were first used (the
 * API's perApp order) — never sorted by time or counts. Each line is the app, its tab visible
 * time ("no browser time" for an app seen only through API calls) and its first and last recorded
 * event. At most DAY_APP_LINES_SHOWN lines until "+N more" is pressed: local state, no fetch.
 */
export function DayAppList({ day, linkQuery }: { day: UserDayActivityDto; linkQuery: LinkQuery }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const { shown, hidden } = visibleAppLines(day);
  const lines = expanded ? day.perApp : shown;
  return (
    <div className="space-y-1">
      <ul id={listId} className="space-y-1">
        {lines.map((app) => (
          <li key={app.app} className="flex items-center gap-1.5 text-xs whitespace-nowrap">
            <AppChip app={app.app} linkQuery={linkQuery} />
            <span className="tabular">{appTimeLabel(app)}</span>
            <span className="text-2xs text-muted-foreground tabular">{appClockSpan(app)}</span>
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          className={MORE_BUTTON_CLASS}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? 'Show fewer' : `+${hidden} more`}
        </button>
      ) : null}
    </div>
  );
}
