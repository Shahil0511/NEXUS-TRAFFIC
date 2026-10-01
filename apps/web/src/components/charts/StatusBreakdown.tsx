import type { StatusCountDto } from '@nexus/shared';

import { StatusCode } from '@/components/StatusCode';
import { formatInteger, formatPercent } from '@/lib/format';

import { CHART_COLORS } from './chartTheme';

const SERVER_ERROR_MIN = 500;
const CLIENT_ERROR_MIN = 400;
const PERCENT = 100;

function colorOf(status: number): string {
  if (status >= SERVER_ERROR_MIN) return CHART_COLORS.errors5xx;
  if (status >= CLIENT_ERROR_MIN) return CHART_COLORS.errors4xx;
  return CHART_COLORS.requests;
}

/**
 * WHY: a ranked list of status codes with proportional bars. HTML rather than an SVG chart: each
 * row is directly labelled (code, count, share), so it reads like a table and needs no tooltip.
 */
export function StatusBreakdown({ items }: { items: readonly StatusCountDto[] }) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <ul className="space-y-2" aria-label="Requests by status code">
      {items.map((item) => (
        <li key={item.status} className="grid grid-cols-[3rem_1fr_auto] items-center gap-3 text-xs">
          <StatusCode status={item.status} />
          <span className="h-2 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${(item.count / max) * PERCENT}%`,
                background: colorOf(item.status),
              }}
            />
          </span>
          <span className="w-28 text-right tabular">
            <span className="font-semibold">{formatInteger(item.count)}</span>
            <span className="ml-1.5 text-muted-foreground">
              {formatPercent(total > 0 ? (item.count / total) * PERCENT : null)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
