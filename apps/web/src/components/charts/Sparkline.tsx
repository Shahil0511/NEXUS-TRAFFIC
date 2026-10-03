'use client';

import { Line, LineChart } from 'recharts';

import { CHART_COLORS } from './chartTheme';

export interface SparklineProps {
  values: readonly number[];
  /** Accessible summary, e.g. "Uses per bucket, 12 to 40". */
  ariaLabel: string;
  width?: number;
  height?: number;
}

const DEFAULT_WIDTH = 112;
const DEFAULT_HEIGHT = 28;
const STROKE_INSET = { top: 3, right: 2, bottom: 3, left: 2 } as const;

/**
 * WHY: a trend inside a table row (tool usage per bucket). Shape only — no axes, grid or tooltip;
 * the row's numbers carry the values. A fixed size (no ResponsiveContainer) keeps rows aligned and
 * avoids one resize observer per row.
 */
export function Sparkline({
  values,
  ariaLabel,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
}: SparklineProps) {
  const data = values.map((value, index) => ({ index, value }));
  return (
    <figure role="img" aria-label={ariaLabel} className="m-0 inline-block align-middle">
      <LineChart width={width} height={height} data={data} margin={STROKE_INSET}>
        <Line
          type="monotone"
          dataKey="value"
          stroke={CHART_COLORS.requests}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </figure>
  );
}
