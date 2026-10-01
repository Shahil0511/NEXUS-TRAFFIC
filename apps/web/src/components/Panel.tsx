import type { ReactNode } from 'react';

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
  children: ReactNode;
}

/**
 * WHY: every chart/list block on a page has the same frame — a titled card whose heading names
 * the region for screen readers (aria-labelledby) — so pages compose panels instead of
 * re-styling cards.
 */
export function Panel({
  title,
  description,
  aside,
  className,
  contentClassName,
  children,
}: PanelProps) {
  const headingId = `panel-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <Card className={className} aria-labelledby={headingId}>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle id={headingId}>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {aside ? <div className="shrink-0">{aside}</div> : null}
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
