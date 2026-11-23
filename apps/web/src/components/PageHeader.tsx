'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { activeNavItem } from '@/lib/nav';

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
 * inside a hero band that says what the page is FOR. The purpose sentence (English + Hinglish)
 * comes from the page's nav item (lib/nav.ts), so a list page always tells the reader "what am I
 * looking at" without each view repeating it. Detail pages (a deeper path) show their own
 * description only.
 */
export function PageHeader({ title, description, actions, eyebrow }: PageHeaderProps) {
  const pathname = usePathname() ?? '';
  const item = activeNavItem(pathname);
  const isListPage = item !== undefined && pathname === item.href;
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
        className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-[#71006a] via-[#c026b5] to-transparent"
      />
      <div className="relative flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 space-y-1.5">
          {eyebrow ? (
            <div className="text-xs text-muted-foreground">{eyebrow}</div>
          ) : item ? (
            <p className="flex items-center gap-2 text-2xs font-semibold tracking-[0.18em] text-primary uppercase">
              <span aria-hidden="true" className="h-px w-6 bg-primary/60" />
              {item.label}
            </p>
          ) : null}
          <h1 className="truncate font-heading text-3xl leading-tight font-bold tracking-tight">
            {title}
          </h1>
          {isListPage ? (
            <p className="max-w-3xl text-sm text-foreground/90">
              {item.question}{' '}
              <span className="text-muted-foreground italic">({item.questionHi})</span>
            </p>
          ) : null}
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
