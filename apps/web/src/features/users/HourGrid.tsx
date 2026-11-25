import type { UserActivityPatternDto } from '@nexus/shared';
import { Fragment } from 'react';

import { formatHoursMinutes, formatInteger } from '@/lib/format';

import {
  HOURS_PER_DAY,
  hourCellOpacity,
  hourGridCells,
  hourRangeLabel,
  type HourGridCell,
} from './dailyActivity';

/** Hour labels above the grid: every 6 hours, India time. */
const HOUR_TICK_EVERY = 6;
const HOURS = Array.from({ length: HOURS_PER_DAY }, (_, hour) => hour);
/** The legend's sample shades: none, half and all of those weekdays had activity. */
const LEGEND = [
  { share: 0, label: 'none' },
  { share: 0.5, label: 'half' },
  { share: 1, label: 'all' },
] as const;

/** The text of one cell in the hidden table: "4 of 4, 2 h 10 min" ("0 of 4" when empty). */
function cellText(cell: HourGridCell): string {
  const days = `${formatInteger(cell.activeDays)} of ${formatInteger(cell.weekdayDays)}`;
  return cell.activeMs > 0 ? `${days}, ${formatHoursMinutes(cell.activeMs)}` : days;
}

/** One shaded square: muted when empty, the one data colour at the cell's opacity otherwise. */
function Swatch({ share }: { share: number }) {
  return (
    <span className="relative block h-full w-full rounded-[3px] bg-muted ring-1 ring-border ring-inset">
      <span
        className="absolute inset-0 rounded-[3px] bg-primary"
        style={{ opacity: hourCellOpacity(share) }}
      />
    </span>
  );
}

/**
 * WHY: when in the week (Mon..Sun × 00..23, India time) this person's activity was recorded, as a
 * 7 × 24 grid in ONE colour: a cell is darker the more of that weekday's days in the window had any
 * activity in that hour. It shows when, never how much compared with anyone. The drawn grid is
 * decorative for screen readers (each cell still carries its sentence as title and label for a
 * pointer); a visually hidden table with a caption and row / column headers holds the same data
 * as text, and a legend names the shades, so no meaning rests on colour alone.
 */
export function HourGrid({ pattern }: { pattern: UserActivityPatternDto }) {
  const rows = hourGridCells(pattern);
  return (
    <div className="space-y-3">
      <div
        aria-hidden="true"
        data-slot="hour-grid"
        className="grid gap-[2px] text-2xs text-muted-foreground tabular"
        style={{ gridTemplateColumns: `auto repeat(${HOURS_PER_DAY}, minmax(0, 1fr))` }}
      >
        <span />
        {HOURS.map((hour) => (
          <span key={hour} className="h-4 overflow-visible whitespace-nowrap">
            {hour % HOUR_TICK_EVERY === 0 ? String(hour).padStart(2, '0') : ''}
          </span>
        ))}
        {rows.map((row) => (
          <Fragment key={row.weekday}>
            <span className="flex items-center pr-2">{row.name.slice(0, 3)}</span>
            {row.cells.map((cell) => (
              <span
                key={cell.hour}
                role="img"
                aria-label={cell.label}
                title={cell.label}
                data-testid="hour-grid-cell"
                className="block h-5"
              >
                <Swatch share={cell.share} />
              </span>
            ))}
          </Fragment>
        ))}
      </div>

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
        <span>Share of those weekdays with activity in the hour:</span>
        {LEGEND.map((item) => (
          <span key={item.label} className="inline-flex items-center gap-1">
            <span aria-hidden="true" className="inline-block size-3">
              <Swatch share={item.share} />
            </span>
            {item.label}
          </span>
        ))}
      </p>

      {/* The wrapper is hidden, not the table: a block box keeps width 1px and overflow hidden,
          while a 25-column table box would size to its content and could widen the page. */}
      <div data-slot="hour-grid-table" className="sr-only">
        <table>
          <caption>
            Usual activity hours, India time: on how many days of each weekday in the range there
            was activity in each hour, and the tab visible time
          </caption>
          <thead>
            <tr>
              <th scope="col">Weekday</th>
              {HOURS.map((hour) => (
                <th key={hour} scope="col">
                  {hourRangeLabel(hour)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.weekday}>
                <th scope="row">{row.name}</th>
                {row.cells.map((cell) => (
                  <td key={cell.hour}>{cellText(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
