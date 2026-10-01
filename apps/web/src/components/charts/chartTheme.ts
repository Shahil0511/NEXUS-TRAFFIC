/**
 * Shared recharts styling: CSS-variable colours (they follow the theme class) and recessive axes.
 *
 * WHY: every chart reads the same tokens from src/app/globals.css, so a palette change is one
 * edit there. 4xx/5xx use the reserved status hues (warning/critical) and never stand in for
 * an ordinary series.
 */
export const CHART_COLORS = {
  requests: 'var(--chart-requests)',
  errors4xx: 'var(--chart-4xx)',
  errors5xx: 'var(--chart-5xx)',
  grid: 'var(--chart-grid)',
  axis: 'var(--chart-axis)',
  cursor: 'var(--chart-cursor)',
  surface: 'var(--card)',
} as const;

export const CHART_HEIGHT = 224;

export const AXIS_TICK = { fill: CHART_COLORS.axis, fontSize: 11 } as const;

/** Props spread onto XAxis/YAxis: no axis lines or tick marks, small muted labels. */
export const AXIS_PROPS = {
  axisLine: false,
  tickLine: false,
  tick: AXIS_TICK,
  tickMargin: 8,
} as const;

export const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: 0 } as const;
