import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { type DailyTrendPoint, trendPointNotes } from '@/features/users/dailyActivity';
import { formatDay, formatHoursMinutes } from '@/lib/format';
import { USER_DAILY } from '@/test/fixtures';

import { ChartTooltip, type ChartTooltipSeries } from './ChartTooltip';

const SERIES: readonly ChartTooltipSeries[] = [
  {
    key: 'activeMs',
    label: 'Tab visible time',
    color: 'var(--chart-1)',
    format: formatHoursMinutes,
  },
];

/** 1 Oct of the fixture: 09:10 → 18:40 IST, 3 h 12 min visible, ebo-sales only. */
function point(): DailyTrendPoint {
  const [day] = USER_DAILY.items;
  if (!day) throw new Error('fixture');
  return { day: day.day, activeMs: day.activeMs, activity: day };
}

/**
 * Recharts hands `content` the hovered datum as payload[0].payload; DailyBarChart passes it on
 * unchanged, so this is the tooltip a hovered bar shows.
 */
function renderTooltip(withNotes: boolean) {
  const datum = point();
  return render(
    <ChartTooltip
      active
      label={datum.day}
      payload={[{ payload: datum }]}
      series={SERIES}
      formatLabel={formatDay}
      notes={withNotes ? (value) => trendPointNotes(value as DailyTrendPoint) : undefined}
    />,
  );
}

describe('ChartTooltip', () => {
  it("shows the day, its tab visible time and the hovered day's notes", () => {
    renderTooltip(true);
    expect(screen.getByText(formatDay(point().day))).toBeInTheDocument();
    expect(screen.getByText('Tab visible time')).toBeInTheDocument();
    expect(screen.getByText('3 h 12 min')).toBeInTheDocument();
    expect(screen.getByText('First – last activity 09:10 – 18:40')).toBeInTheDocument();
    expect(screen.getByText('Apps: ebo-sales')).toBeInTheDocument();
  });

  it('renders no notes list when `notes` is not given', () => {
    renderTooltip(false);
    expect(screen.getByText('3 h 12 min')).toBeInTheDocument();
    expect(screen.getAllByRole('list')).toHaveLength(1);
    expect(screen.queryByText(/First – last activity/)).toBeNull();
  });

  it('renders nothing when inactive', () => {
    const { container } = render(
      <ChartTooltip
        active={false}
        label={point().day}
        payload={[{ payload: point() }]}
        series={SERIES}
        formatLabel={formatDay}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
