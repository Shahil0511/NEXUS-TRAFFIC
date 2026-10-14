'use client';

import { useIsFetching } from '@tanstack/react-query';
import { Activity, Clock } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { CommandPalette } from '@/components/CommandPalette';
import { DashboardNav, MobileNav } from '@/components/MobileNav';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ViewerBadge } from '@/components/ViewerBadge';
import { AppSelect } from '@/features/filters/AppSelect';
import { RangePicker } from '@/features/filters/RangePicker';
import { filterLinkQuery, useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { pageFiltersFor } from '@/lib/nav';
import { PAGES, withQuery } from '@/lib/pages';
import { cn } from '@/lib/utils';

/** Target of the skip link; the <main> landmark carries it. */
export const MAIN_CONTENT_ID = 'main-content';

/**
 * WHY: the frame of every dashboard page — sidebar navigation (from NAV_SECTIONS, so no href is
 * typed here; below md a menu button opens it as a sheet, see MobileNav), a top bar with search
 * (Ctrl+K), the GLOBAL filters the current page uses (app + range, kept in the URL) and the
 * signed-in viewer. Navigation carries the current filters along,
 * so switching pages keeps the context.
 * A skip link and landmarks (nav/header/main) make it keyboard- and screen-reader-friendly.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <a
        href={`#${MAIN_CONTENT_ID}`}
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="flex-1 px-4 py-4 outline-none sm:px-6 sm:py-6"
        >
          <div className="mx-auto w-full max-w-[1440px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

/** WHY: the md+ navigation rail (labels from lg); below md MobileNav takes over. */
function Sidebar() {
  const { filters } = useGlobalFilters();
  return (
    <aside className="sticky top-0 hidden h-screen w-16 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex lg:w-60">
      <Link
        href={withQuery(PAGES.overview(), filterLinkQuery(filters))}
        className="flex h-14 items-center gap-2.5 px-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        aria-label="Data Nexus Traffic — Overview"
      >
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-violet-700 text-white shadow-sm shadow-violet-500/30"
        >
          <Activity className="size-4" />
        </span>
        <span className="hidden min-w-0 flex-col leading-tight lg:flex">
          <span className="text-2xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Data Nexus
          </span>
          <span className="text-sm font-semibold text-foreground">Traffic</span>
        </span>
      </Link>
      <DashboardNav variant="rail" className="flex-1" />
      <p className="hidden items-center gap-1.5 border-t border-sidebar-border px-4 py-3 text-2xs text-muted-foreground lg:flex">
        <Clock className="size-3" aria-hidden="true" />
        All times in IST
      </p>
    </aside>
  );
}

// ─── Top bar ─────────────────────────────────────────────────────────────────

/**
 * WHY: a thin bar under the header while ANY query loads — data refreshing in the background
 * (a filter change keeps the old numbers on screen) must still be visible.
 */
function FetchingBar() {
  const fetching = useIsFetching() > 0;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary transition-opacity duration-300',
        fetching ? 'animate-pulse opacity-70' : 'opacity-0',
      )}
    />
  );
}

/**
 * WHY: search, the filters the current page reads, theme and viewer — on one row from md. Below
 * md (no sidebar, a menu button instead) the filters drop to a full-width second row: nothing may
 * overflow a 360px phone. On one row the filters keep their natural width and give way only by
 * truncating (app name, custom-range label); the search button takes whatever is left.
 */
function TopBar() {
  const pathname = usePathname();
  const pageFilters = pageFiltersFor(pathname);
  const hasFilters = pageFilters.app || pageFilters.range;
  return (
    <header className="sticky top-0 z-30 flex min-h-14 flex-wrap items-center gap-2 border-b border-border bg-background/80 px-3 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-6 md:h-14 md:flex-nowrap md:gap-3 md:py-0">
      <MobileNav />
      <CommandPalette />
      {hasFilters ? (
        <div
          role="group"
          aria-label="Global filters"
          className="order-last flex w-full min-w-0 items-center gap-2 md:order-none md:ml-auto md:w-auto"
        >
          {pageFilters.app ? (
            <AppSelect className="min-w-0 flex-1 md:w-32 md:min-w-24 md:flex-initial lg:w-40 xl:w-52" />
          ) : null}
          {pageFilters.range ? <RangePicker maxRangeMs={pageFilters.maxRangeMs} /> : null}
        </div>
      ) : null}
      <div className={cn('ml-auto flex min-w-0 items-center gap-2', hasFilters && 'md:ml-0')}>
        <ThemeToggle />
        <span aria-hidden="true" className="h-5 w-px bg-border" />
        <ViewerBadge />
      </div>
      <FetchingBar />
    </header>
  );
}
