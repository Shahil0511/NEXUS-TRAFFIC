'use client';

import { FileText, MousePointerClick, type LucideIcon } from 'lucide-react';
import Link from 'next/link';

import { filterLinkQuery, useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { PAGES, withQuery } from '@/lib/pages';
import { cn } from '@/lib/utils';

export type PagesToolsTab = 'pages' | 'tools';

const TABS: readonly { id: PagesToolsTab; label: string; href: string; icon: LucideIcon }[] = [
  { id: 'pages', label: 'Pages', href: PAGES.pages(), icon: FileText },
  { id: 'tools', label: 'Tools', href: PAGES.tools(), icon: MousePointerClick },
];

/**
 * WHY: "Pages & Tools" is ONE sidebar entry (lib/nav.ts, alsoActiveOn) over two routes, so each
 * has its own URL to share. These links switch between them, keeping the global filters, and look
 * like the SegmentedControl used elsewhere.
 */
export function PagesToolsTabs({ active }: { active: PagesToolsTab }) {
  const { filters } = useGlobalFilters();
  const linkQuery = filterLinkQuery(filters);
  return (
    <nav
      aria-label="Pages and tools"
      className="inline-flex h-8 items-center gap-0.5 rounded-lg bg-muted p-0.5 ring-1 ring-border ring-inset"
    >
      {TABS.map(({ id, label, href, icon: Icon }) => (
        <Link
          key={id}
          href={withQuery(href, linkQuery)}
          aria-current={id === active ? 'page' : undefined}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60',
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
