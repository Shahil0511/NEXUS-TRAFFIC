'use client';

import { FileText, MousePointerClick, Waypoints, type LucideIcon } from 'lucide-react';
import Link from 'next/link';

import { filterLinkQuery, useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { PAGES, withQuery } from '@/lib/pages';
import { cn } from '@/lib/utils';

/** Which of the three lists is open (`tools` = the Features list; the route keeps its name). */
export type PagesToolsTab = 'pages' | 'tools' | 'endpoints';

const TABS: readonly { id: PagesToolsTab; label: string; href: string; icon: LucideIcon }[] = [
  { id: 'pages', label: 'Pages', href: PAGES.pages(), icon: FileText },
  { id: 'tools', label: 'Features', href: PAGES.tools(), icon: MousePointerClick },
  { id: 'endpoints', label: 'Request types', href: PAGES.endpoints(), icon: Waypoints },
];

/**
 * WHY: pages, features and request types are three lists of what an app is used for, so one tab
 * row switches between their three routes (/pages, /tools, /endpoints), keeping the global
 * filters. Each route keeps its own URL to share; the sidebar still has two items over them
 * ("Pages & features" covers /pages and /tools via alsoActiveOn; "Request types" is its own, see
 * lib/nav.ts). Looks like the SegmentedControl used elsewhere, and WRAPS (no fixed height) so the
 * three links fit inside the page header on a 360 px phone instead of overflowing it.
 */
export function PagesToolsTabs({ active }: { active: PagesToolsTab }) {
  const { filters } = useGlobalFilters();
  const linkQuery = filterLinkQuery(filters);
  return (
    <nav
      aria-label="Pages, features and request types"
      className="flex min-h-8 max-w-full flex-wrap items-center gap-0.5 rounded-lg bg-muted p-0.5 ring-1 ring-border ring-inset"
    >
      {TABS.map(({ id, label, href, icon: Icon }) => (
        <Link
          key={id}
          href={withQuery(href, linkQuery)}
          aria-current={id === active ? 'page' : undefined}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs whitespace-nowrap font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60',
            id === active && 'bg-card text-foreground shadow-sm dark:bg-input/40',
          )}
        >
          <Icon className="size-3.5" aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
