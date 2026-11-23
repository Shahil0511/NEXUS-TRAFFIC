'use client';

import { ArrowUp, Clock } from 'lucide-react';
import { usePathname } from 'next/navigation';

import { usePageEndStatus, type PageEndStatus } from '@/components/PageEndProvider';
import { Button } from '@/components/ui/button';
import { activeNavItem } from '@/lib/nav';

/** What each status colour means, the same on every page. */
const COLOUR_LEGEND = [
  { label: 'Failed', className: 'bg-destructive' },
  { label: 'Slow / warning', className: 'bg-warning' },
  { label: 'Live / OK', className: 'bg-success' },
  { label: 'Click to open', className: 'bg-primary' },
] as const;

/**
 * WHY: a page must visibly END. Without it the reader scrolls and cannot tell whether more is
 * still loading or the page is over (owner feedback, 2026-11-23). A labelled divider closes the
 * content, the colour legend repeats what red / amber / green mean, and "Back to top" returns to
 * the filters. It only says "End of …" when that is true: while the page is still on its first
 * load, or a list above can load more rows, it says so instead (usePageEndStatus).
 */
export function PageEnd() {
  const item = activeNavItem(usePathname() ?? '');
  const status = usePageEndStatus();
  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  return (
    <footer aria-label="End of page" data-status={status} className="mt-10 pb-2">
      <div className="flex items-center gap-3 text-2xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
        <span
          aria-hidden="true"
          className="h-px flex-1 bg-gradient-to-r from-transparent to-border"
        />
        <span aria-live="polite">{pageEndLabel(status, item ? item.label : 'page')}</span>
        <span
          aria-hidden="true"
          className="h-px flex-1 bg-gradient-to-l from-transparent to-border"
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-4 py-3 text-2xs text-muted-foreground">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Colour meanings">
          {COLOUR_LEGEND.map((entry) => (
            <li key={entry.label} className="flex items-center gap-1.5">
              <span aria-hidden="true" className={`size-2 rounded-full ${entry.className}`} />
              {entry.label}
            </li>
          ))}
        </ul>
        <span className="flex items-center gap-1.5">
          <Clock className="size-3" aria-hidden="true" />
          All times in IST · Libas Data Nexus Traffic
        </span>
        <Button variant="outline" size="sm" onClick={scrollToTop}>
          <ArrowUp aria-hidden="true" /> Back to top
        </Button>
      </div>
    </footer>
  );
}

/** The divider's words for each state (pure). */
export function pageEndLabel(status: PageEndStatus, pageLabel: string): string {
  if (status === 'loading') return 'Still loading…';
  if (status === 'more') return 'More rows above: use Load more';
  return `End of ${pageLabel}`;
}
