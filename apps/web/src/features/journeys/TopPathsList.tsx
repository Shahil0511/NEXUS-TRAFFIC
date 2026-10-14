import type { TopPathDto } from '@nexus/shared';
import { ChevronRight } from 'lucide-react';
import { Fragment } from 'react';

import { CHART_COLORS } from '@/components/charts/chartTheme';
import { formatInteger } from '@/lib/format';

const PERCENT = 100;

/**
 * WHY: "how do people move through the app?" — the most common 3-page sequences, ranked, with a
 * proportional bar so the gap between #1 and the rest is visible. Path templates are ingested
 * data: text only.
 */
export function TopPathsList({ paths }: { paths: readonly TopPathDto[] }) {
  const max = Math.max(1, ...paths.map((path) => path.sessions));
  return (
    <ol className="divide-y divide-border/70" aria-label="Top paths">
      {paths.map((path, index) => (
        <li
          key={`${path.app}|${path.steps.join('|')}`}
          className="grid grid-cols-[1.5rem_1fr_auto] items-center gap-3 py-2.5 first:pt-0 last:pb-0"
        >
          <span className="text-xs font-semibold text-muted-foreground tabular">{index + 1}</span>
          <span className="min-w-0 space-y-1.5">
            <span className="flex min-w-0 flex-wrap items-center gap-1">
              {path.steps.map((step, stepIndex) => (
                <Fragment key={`${stepIndex}-${step}`}>
                  {stepIndex > 0 ? (
                    <>
                      <ChevronRight
                        className="size-3 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="sr-only">then</span>
                    </>
                  ) : null}
                  <span
                    className="max-w-64 truncate rounded-md bg-muted px-1.5 py-0.5 font-mono text-2xs"
                    title={step}
                  >
                    {step}
                  </span>
                </Fragment>
              ))}
              <span className="ml-1 text-2xs text-muted-foreground">{path.app}</span>
            </span>
            <span className="block h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${(path.sessions / max) * PERCENT}%`,
                  background: CHART_COLORS.requests,
                }}
              />
            </span>
          </span>
          <span className="text-right text-xs tabular">
            <span className="block font-semibold">{formatInteger(path.sessions)}</span>
            <span className="block text-2xs text-muted-foreground">
              {path.sessions === 1 ? 'session' : 'sessions'}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
