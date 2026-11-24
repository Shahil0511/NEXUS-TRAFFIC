'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { NAV_ILLUSTRATIONS } from '@/components/illustrations';
import { activeNavItem, type NavItem } from '@/lib/nav';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Right-aligned page-level controls (search, filters). */
  actions?: ReactNode;
  /** Small line above the title (breadcrumb / back link). */
  eyebrow?: ReactNode;
}

/**
 * WHY: every page opens the same way — one h1 (landmark for screen readers) and its controls —
 * inside a hero band that says what the page is FOR. The purpose sentence (plain English)
 * comes from the page's nav item (lib/nav.ts), so a list page always tells the reader "what am I
 * looking at" without each view repeating it. Detail pages (a deeper path) show their own
 * description only.
 *
 * The section's nav icon sits in a plum tile left of the title and its motif
 * (components/illustrations) on the right from md up; both are decorative (aria-hidden) and both
 * follow the active nav item, so a detail page wears its section's look. The motif shows on list
 * pages only: a detail title is a long identifier (an email, a route, a page path) whose END tells
 * two items apart, so it gets the full width and wraps instead of being cut off.
 */
export function PageHeader({ title, description, actions, eyebrow }: PageHeaderProps) {
  const pathname = usePathname() ?? '';
  const item = activeNavItem(pathname);
  const isListPage = item !== undefined && pathname === item.href;
  const Illustration = item && isListPage ? NAV_ILLUSTRATIONS[item.id] : undefined;
  return (
    <div
      data-spotlight
      className="relative overflow-hidden rounded-2xl border border-border bg-card/80 px-5 py-5 shadow-raised backdrop-blur-sm sm:px-6 sm:py-6"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-primary/10 blur-3xl"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-brand-from via-brand-to to-transparent"
      />
      <div className="relative flex items-center gap-6">
        <div className="flex min-w-0 flex-1 flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 items-start gap-3 sm:gap-4">
            {item ? <PageIconTile item={item} /> : null}
            <div className="min-w-0 space-y-1.5">
              {eyebrow ? (
                <div className="text-xs text-muted-foreground">{eyebrow}</div>
              ) : item ? (
                <p className="flex items-center gap-2 text-2xs font-semibold tracking-[0.18em] text-primary uppercase">
                  <span aria-hidden="true" className="h-px w-6 bg-primary/60" />
                  {item.label}
                </p>
              ) : null}
              <h1
                className={cn(
                  'font-heading text-3xl leading-tight font-bold tracking-tight',
                  isListPage ? 'truncate' : 'break-words [overflow-wrap:anywhere]',
                )}
              >
                {title}
              </h1>
              {isListPage ? (
                <p className="max-w-3xl text-sm text-foreground/90">{item.question}</p>
              ) : null}
              {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
            </div>
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
        {Illustration ? <Illustration className="hidden w-40 shrink-0 md:block xl:w-52" /> : null}
      </div>
    </div>
  );
}

/** The section's nav icon in the brand gradient tile (decorative: the h1 names the page). */
function PageIconTile({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <span
      aria-hidden="true"
      data-slot="page-icon"
      className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-from to-brand-to text-brand-foreground shadow-raised sm:size-12 sm:rounded-2xl"
    >
      <Icon className="size-5 sm:size-6" />
    </span>
  );
}
