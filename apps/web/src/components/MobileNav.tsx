'use client';

import { Activity, Clock, Menu } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { filterLinkQuery, useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { isNavItemActive, NAV_SECTIONS, type NavItem } from '@/lib/nav';
import { withQuery } from '@/lib/pages';
import { cn } from '@/lib/utils';

/**
 * How the navigation is laid out: `rail` is the desktop sidebar (icons only from md, labels from
 * lg); `full` is the mobile sheet, which always has room for the labels.
 */
export type DashboardNavVariant = 'rail' | 'full';

/**
 * WHY: the ONE rendering of NAV_SECTIONS, shared by the desktop sidebar and the mobile sheet, so
 * both list the same pages, highlight the same item (isNavItemActive) and carry the current global
 * filters on every link. `onNavigate` lets the sheet close as soon as a link is followed.
 */
export function DashboardNav({
  variant,
  onNavigate,
  className,
}: {
  variant: DashboardNavVariant;
  onNavigate?: () => void;
  className?: string;
}) {
  const pathname = usePathname();
  const { filters } = useGlobalFilters();
  const linkQuery = filterLinkQuery(filters);
  const rail = variant === 'rail';
  return (
    <nav aria-label="Dashboard" className={cn('space-y-5 overflow-y-auto px-2 py-4', className)}>
      {NAV_SECTIONS.map((section) => (
        <div key={section.id} className="space-y-1">
          <p
            className={cn(
              'px-2.5 text-2xs font-semibold tracking-[0.12em] text-muted-foreground uppercase',
              rail && 'hidden lg:block',
            )}
          >
            {section.label}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => (
              <li key={item.id}>
                <NavLink
                  item={item}
                  href={withQuery(item.href, linkQuery)}
                  active={isNavItemActive(item, pathname)}
                  rail={rail}
                  onNavigate={onNavigate}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** WHY: one nav entry — icon, label and "coming in" badge; aria-current marks the open page. */
function NavLink({
  item,
  href,
  active,
  rail,
  onNavigate,
}: {
  item: NavItem;
  href: string;
  active: boolean;
  rail: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      title={rail ? item.label : undefined}
      onClick={onNavigate}
      className={cn(
        'group flex items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
        rail ? 'h-8' : 'h-10',
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
      <span className={cn('flex-1 truncate', rail && 'hidden lg:inline')}>{item.label}</span>
      {item.comingIn ? (
        <Badge
          variant="muted"
          className={cn(rail && 'hidden lg:inline-flex')}
          aria-label={`coming in ${item.comingIn}`}
        >
          {item.comingIn}
        </Badge>
      ) : null}
    </Link>
  );
}

/**
 * WHY: below md there is no room for the sidebar, so the top bar shows a menu button that opens
 * the same navigation in a left sheet. The sheet is a Radix Dialog (focus trap, Escape, scroll
 * lock, labelled by its title); following a link closes it and Radix returns focus to the button.
 */
export function MobileNav({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open navigation"
          className={cn('md:hidden', className)}
        >
          <Menu aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent className="top-0 left-0 h-dvh max-h-dvh w-72 max-w-[85vw] translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none rounded-r-xl bg-sidebar p-0 text-sidebar-foreground data-[state=open]:slide-in-from-left data-[state=open]:zoom-in-100">
        <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-4 pr-12">
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-violet-700 text-white shadow-sm shadow-violet-500/30"
          >
            <Activity className="size-4" />
          </span>
          <DialogTitle className="text-sm">Data Nexus Traffic</DialogTitle>
        </div>
        <DialogDescription className="sr-only">
          Pages of the dashboard. Links keep the current app and time range.
        </DialogDescription>
        <DashboardNav variant="full" onNavigate={() => setOpen(false)} className="flex-1" />
        <p className="flex shrink-0 items-center gap-1.5 border-t border-sidebar-border px-4 py-3 text-2xs text-muted-foreground">
          <Clock className="size-3" aria-hidden="true" />
          All times in IST
        </p>
      </DialogContent>
    </Dialog>
  );
}
