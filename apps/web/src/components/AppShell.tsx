'use client';

import { useIsFetching } from '@tanstack/react-query';
import { Activity, Clock } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { CommandPalette } from '@/components/CommandPalette';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Badge } from '@/components/ui/badge';
import { ViewerBadge } from '@/components/ViewerBadge';
import { AppSelect } from '@/features/filters/AppSelect';
import { RangePicker } from '@/features/filters/RangePicker';
import { filterLinkQuery, useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { isNavItemActive, NAV_SECTIONS, pageFiltersFor, type NavItem } from '@/lib/nav';
import { PAGES, withQuery } from '@/lib/pages';
import { cn } from '@/lib/utils';

/** Target of the skip link; the <main> landmark carries it. */
export const MAIN_CONTENT_ID = 'main-content';

/**
 * WHY: the frame of every dashboard page — sidebar navigation (from NAV_SECTIONS, so no href is
 * typed here), a top bar with search (Ctrl+K), the GLOBAL filters the current page uses (app +
 * range, kept in the URL) and the signed-in viewer. Navigation carries the current filters along,
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
        <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex-1 px-6 py-6 outline-none">
          <div className="mx-auto w-full max-w-[1440px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function Sidebar() {
  const pathname = usePathname();
  const { filters } = useGlobalFilters();
  const linkQuery = filterLinkQuery(filters);
  return (
    <aside className="sticky top-0 flex h-screen w-16 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:w-60">
      <Link
        href={withQuery(PAGES.overview(), linkQuery)}
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
          <span className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Data Nexus
          </span>
          <span className="text-sm font-semibold text-foreground">Traffic</span>
        </span>
      </Link>
      <nav aria-label="Dashboard" className="flex-1 space-y-5 overflow-y-auto px-2 py-4">
        {NAV_SECTIONS.map((section) => (
          <div key={section.id} className="space-y-1">
            <p className="hidden px-2.5 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground/80 uppercase lg:block">
              {section.label}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.id}>
                  <NavLink
                    item={item}
                    href={withQuery(item.href, linkQuery)}
                    active={isNavItemActive(item, pathname)}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <p className="hidden items-center gap-1.5 border-t border-sidebar-border px-4 py-3 text-[11px] text-muted-foreground lg:flex">
        <Clock className="size-3" aria-hidden="true" />
        All times in IST
      </p>
    </aside>
  );
}

function NavLink({ item, href, active }: { item: NavItem; href: string; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      title={item.label}
      className={cn(
        'group flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <Icon
        className={cn(
          'size-4 shrink-0',
          active ? '' : 'text-muted-foreground group-hover:text-foreground',
        )}
        aria-hidden="true"
      />
      <span className="hidden flex-1 truncate lg:inline">{item.label}</span>
      {item.comingIn ? (
        <Badge
          variant="muted"
          className="hidden lg:inline-flex"
          aria-label={`coming in ${item.comingIn}`}
        >
          {item.comingIn}
        </Badge>
      ) : null}
    </Link>
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

function TopBar() {
  const pathname = usePathname();
  const pageFilters = pageFiltersFor(pathname);
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <CommandPalette />
      <div
        role="group"
        aria-label="Global filters"
        className="flex min-w-0 flex-1 items-center justify-end gap-2"
      >
        {pageFilters.app ? <AppSelect className="w-40 xl:w-52" /> : null}
        {pageFilters.range ? <RangePicker maxRangeMs={pageFilters.maxRangeMs} /> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ThemeToggle />
        <span aria-hidden="true" className="h-5 w-px bg-border" />
        <ViewerBadge />
      </div>
      <FetchingBar />
    </header>
  );
}
