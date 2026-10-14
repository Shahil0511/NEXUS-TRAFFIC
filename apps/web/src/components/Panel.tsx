import { useId, type ReactNode, type Ref } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { CHART_HEIGHT } from './charts/chartTheme';

export interface PanelProps {
  title: string;
  description?: ReactNode;
  /** Right side of the header: legend, link, filter. */
  aside?: ReactNode;
  className?: string;
  contentClassName?: string;
  /**
   * Makes the heading a programmatic focus target (tabIndex -1). WHY: when a control inside the
   * panel removes itself (a filter chip), focus moves here instead of falling to <body>.
   */
  headingRef?: Ref<HTMLHeadingElement>;
  children: ReactNode;
}

/**
 * WHY: every chart/list block on a page has the same frame — a titled card whose heading names
 * the region for screen readers (aria-labelledby) — so pages compose panels instead of
 * re-styling cards. The heading id comes from useId, NOT the title: two panels with the same
 * title on one page (e.g. "Countries") must still label their own region.
 *
 * Header layout: title left, aside right; when both do not fit (360px phone, a wide filter row)
 * the aside WRAPS onto its own line and stays shrinkable (min-w-0, max-w-full) — a `shrink-0`
 * aside overflowed the card and squeezed the title to 0 width. The title's huge grow factor keeps
 * the aside at its content width on a shared line; alone on its line the aside takes the full
 * width, so a `w-full sm:w-56` filter really is full width on a phone.
 */
export function Panel({
  title,
  description,
  aside,
  className,
  contentClassName,
  headingRef,
  children,
}: PanelProps) {
  const headingId = `panel-${useId()}`;
  return (
    <Card className={className} aria-labelledby={headingId}>
      <CardHeader className="flex-wrap">
        <div data-slot="panel-title" className="min-w-0 grow-[999] basis-48">
          <CardTitle
            id={headingId}
            ref={headingRef}
            tabIndex={headingRef ? -1 : undefined}
            className={
              headingRef
                ? 'rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60'
                : undefined
            }
          >
            {title}
          </CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {aside ? (
          <div data-slot="panel-aside" className="flex min-w-0 max-w-full grow justify-end">
            {aside}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className={cn('flex-1', contentClassName)}>{children}</CardContent>
    </Card>
  );
}

/** Placeholder with the exact chart height, so loading never shifts the layout. */
export function ChartSkeleton() {
  return <Skeleton className="w-full" style={{ height: CHART_HEIGHT }} />;
}

/** Placeholder for ranked lists (top endpoints, status codes). */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-5 w-full" />
      ))}
    </div>
  );
}
