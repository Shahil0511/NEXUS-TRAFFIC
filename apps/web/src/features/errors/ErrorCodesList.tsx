'use client';

import type { ErrorCodeCountDto } from '@nexus/shared';
import { Check } from 'lucide-react';

import { CHART_COLORS } from '@/components/charts/chartTheme';
import { EmptyState } from '@/components/EmptyState';
import { formatInteger } from '@/lib/format';
import { cn } from '@/lib/utils';

const PERCENT = 100;

export interface ErrorCodesListProps {
  items: readonly ErrorCodeCountDto[];
  /** The code the page is scoped to (`?errorCode=`), if any. */
  selected: string | undefined;
  /** Scopes the page to one code (or toggles the scope off when it is the selected one). */
  onSelect: (errorCode: string) => void;
}

/** "1 route" / "3 routes". */
function routesLabel(routes: number): string {
  return `${formatInteger(routes)} ${routes === 1 ? 'route' : 'routes'}`;
}

/**
 * WHY: "what kind of failure is it?" — status codes say 500, the app's own error code says
 * QUERY_TIMEOUT. Codes are ranked by failures with a proportional bar and the number of routes they
 * hit; a click scopes the whole page to that code (`?errorCode=`). The code is ingested data but
 * CHECK-constrained to `[A-Z0-9_]` (never a message), and it is only rendered as text and sent as a
 * query VALUE — never part of a path or href. Failures sent without a code are listed (so the
 * counts add up) but cannot be selected.
 */
export function ErrorCodesList({ items, selected, onSelect }: ErrorCodesListProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        className="py-6"
        title="No error codes"
        description="Nothing failed in this window."
      />
    );
  }
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <ol className="-mx-2 space-y-0.5" aria-label="Error codes">
      {items.map((item) => {
        const bar = (
          <span
            className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted"
            aria-hidden="true"
          >
            <span
              className="block h-full rounded-full"
              style={{
                width: `${(item.count / max) * PERCENT}%`,
                // Neutral like "Most affected users": a code can be 4xx OR 5xx, and the page's
                // chart legend reserves the 4xx / 5xx colours for the status class.
                backgroundColor: CHART_COLORS.requests,
              }}
            />
          </span>
        );
        const numbers = (
          <span className="shrink-0 text-right text-xs tabular">
            <span className="block font-semibold">{formatInteger(item.count)}</span>
            <span className="block text-2xs text-muted-foreground">
              {routesLabel(item.routes)}
            </span>
          </span>
        );

        if (item.errorCode === null) {
          return (
            <li key="no-code" className="flex items-center gap-2.5 px-2 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-muted-foreground italic">
                  No code sent
                </span>
                {bar}
              </span>
              {numbers}
            </li>
          );
        }

        const code = item.errorCode;
        const isSelected = code === selected;
        return (
          <li key={code}>
            <button
              type="button"
              aria-pressed={isSelected}
              aria-label={`${code}: ${formatInteger(item.count)} failed, ${routesLabel(item.routes)}${
                isSelected ? ' (filtering)' : ''
              }`}
              onClick={() => onSelect(code)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60',
                isSelected && 'bg-muted',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-mono text-xs">{code}</span>
                  {isSelected ? (
                    <Check className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                  ) : null}
                </span>
                {bar}
              </span>
              {numbers}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
