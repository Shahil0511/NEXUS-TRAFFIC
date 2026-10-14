import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { PAGES, withQuery } from '@/lib/pages';
import { cn } from '@/lib/utils';

type LinkQuery = Readonly<Record<string, string | undefined>>;

/** One step of the trail. `href` MUST come from PAGES (+ withQuery); the last step is the page. */
export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbsProps {
  items: readonly BreadcrumbItem[];
  className?: string;
}

/**
 * WHY: a detail page reached from a deep link must say where it sits ("Applications › ebo-sales ›
 * Pages › /orders/:id") and let the user climb back one level at a time — a single "← Back" link
 * only knows one parent. Rendered as the PageHeader eyebrow: a labelled nav landmark with an
 * ordered list, the current page marked aria-current="page". Labels are text only — NEVER pass a
 * full email (mask it with maskEmail).
 */
export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className={cn('min-w-0', className)}>
      <ol className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {items.map((item, index) => {
          const isCurrent = index === items.length - 1;
          return (
            <li key={`${index}-${item.label}`} className="inline-flex min-w-0 items-center gap-1">
              {item.href && !isCurrent ? (
                <Link
                  href={item.href}
                  className="truncate rounded-sm outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={isCurrent ? 'page' : undefined}
                  className={cn('truncate', isCurrent && 'font-medium text-foreground')}
                  title={item.label}
                >
                  {item.label}
                </span>
              )}
              {isCurrent ? null : <ChevronRight className="size-3 shrink-0" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The "Applications › <app>" head of every app-scoped trail (pages, tools, sessions, routes).
 * The app filter is dropped from the hrefs — the app page IS the app (like AppChip).
 * WHY the caller passes the ENTITY's app in `linkQuery`: the section crumb that follows
 * ("Pages", "API Routes", "Journeys") must list that app's items, not whatever ?app= the deep
 * link carried — build it as `{ ...globalFilters, app }` (see PageDetailView).
 */
export function applicationCrumbs(app: string, linkQuery: LinkQuery): BreadcrumbItem[] {
  const query = { ...linkQuery, app: undefined };
  return [
    { label: 'Applications', href: withQuery(PAGES.applications(), query) },
    { label: app, href: withQuery(PAGES.applicationDetail(app), query) },
  ];
}
