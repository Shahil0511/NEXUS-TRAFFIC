'use client';

import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { HealthMark, type CheckState } from '@/components/HealthMark';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** The row's signature: a 3 px left edge in the colour of its outcome (status meaning only). */
const STATE_EDGE: Record<CheckState, string> = {
  pass: 'border-l-success',
  warn: 'border-l-warning',
  fail: 'border-l-destructive',
};

export interface CheckRowProps {
  state: CheckState;
  /** What the mark says ("Healthy", "Action needed"): visible from sm, screen-reader text below. */
  stateLabel: string;
  /**
   * The row's title line. Put the checked thing's name in a heading one level below the section
   * (e.g. `<h3>EBO Sales</h3>`) and keep badges / links beside it, outside the heading element,
   * so moving by heading goes row by row. The wrapper sets the font; the heading inherits it.
   */
  title: ReactNode;
  /** One line on what the check found. */
  summary: ReactNode;
  /** Right side (below on phones), e.g. a "How to fix" link. */
  action?: ReactNode;
  /** The expandable body; without it the row has no "Show details" button. */
  children?: ReactNode;
  defaultOpen?: boolean;
  /** Unique on the page; the details region is `${id}-details`. */
  id: string;
  /**
   * Plain-text name of what is checked (e.g. the app's name): names the details region and is
   * added to the toggle's accessible name ("Show details for EBO Sales"), so several rows stay
   * apart for screen readers. Without it the region is named by the title.
   */
  name?: string;
}

/**
 * WHY: a Checklist page (Data health) answers "is this OK, and what do I do?" one line per item:
 * the mark on the left, title and a one-line summary in the middle, the fix on the right and,
 * when there is more, a "Show details" toggle opening the full body in place, so a long page of
 * cards becomes a short list without losing a block. Rendered as <li>: put rows in a <ul>.
 * Plain React state, no dependency; the body mounts only while open. No charts in the row itself.
 * On phones it stacks (mark beside a column of title, summary, action, button) and never scrolls
 * sideways: the middle is min-w-0 and wraps; wide tables in the body scroll inside their own box.
 */
export function CheckRow({
  state,
  stateLabel,
  title,
  summary,
  action,
  children,
  defaultOpen = false,
  id,
  name,
}: CheckRowProps) {
  const [open, setOpen] = useState(defaultOpen);
  const titleId = `${id}-title`;
  const detailsId = `${id}-details`;
  const hasDetails = children !== undefined && children !== null && children !== false;

  return (
    <li
      data-slot="check-row"
      data-state={state}
      className={cn(
        'min-w-0 rounded-xl border-l-3 bg-card ring-1 ring-border/60',
        STATE_EDGE[state],
      )}
    >
      <div className="flex min-w-0 gap-3 p-4">
        <div className="shrink-0 pt-0.5 sm:w-32">
          <HealthMark state={state} label={stateLabel} labelClassName="max-sm:sr-only" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1 space-y-1">
            <div
              id={titleId}
              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-heading text-base leading-snug font-semibold"
            >
              {title}
            </div>
            <p className="text-xs leading-relaxed break-words text-muted-foreground">{summary}</p>
          </div>
          {action || hasDetails ? (
            <div className="flex flex-wrap items-center gap-2 lg:max-w-xs lg:shrink-0 lg:justify-end">
              {action ? <div className="min-w-0 text-xs">{action}</div> : null}
              {hasDetails ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-expanded={open}
                  aria-controls={detailsId}
                  onClick={() => setOpen((value) => !value)}
                >
                  <ChevronDown
                    aria-hidden="true"
                    className={cn('transition-transform', open && 'rotate-180')}
                  />
                  {open ? 'Hide details' : 'Show details'}
                  {name ? <span className="sr-only"> for {name}</span> : null}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {hasDetails ? (
        <div
          id={detailsId}
          role="region"
          {...(name ? { 'aria-label': name } : { 'aria-labelledby': titleId })}
          hidden={!open}
          className="min-w-0 border-t border-border/60 px-4 pt-4 pb-4"
        >
          {open ? children : null}
        </div>
      ) : null}
    </li>
  );
}
