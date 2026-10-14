'use client';

import type { RangePreset } from '@nexus/shared';
import { Boxes, CalendarRange, CornerDownLeft, Route, Search, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { MethodBadge } from '@/components/MethodBadge';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useAppList } from '@/features/apps/useAppList';
import { useEndpointStats } from '@/features/endpoints/useEndpointStats';
import { RANGE_LABELS } from '@/features/filters/rangeLabels';
import { filterLinkQuery, useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { useUserSearch } from '@/features/users/useUserSearch';
import { NAV_ITEMS } from '@/lib/nav';
import { PAGES, withQuery } from '@/lib/pages';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { cn } from '@/lib/utils';

/** Typing pause before routes/users are searched on the server. */
const SEARCH_DEBOUNCE_MS = 250;
/** Shortest text that triggers a server search (one letter matches nearly everything). */
const MIN_SERVER_SEARCH = 2;
/** Results per server-searched group. */
const GROUP_LIMIT = 5;
/** Range presets offered as palette actions. */
const RANGE_ACTIONS: readonly Exclude<RangePreset, 'custom'>[] = ['1h', '24h', '7d', '30d'];

export interface PaletteItem {
  id: string;
  group: 'Pages' | 'Applications' | 'Users' | 'API routes' | 'Time range';
  label: ReactNode;
  /** Plain text matched against the query and read by screen readers. */
  text: string;
  sublabel?: string;
  icon: ReactNode;
  /** Navigate here… */
  href?: string;
  /** …or run this. */
  run?: () => void;
}

/** Where the server search is: decides what an empty result list says. */
type SearchStatus = 'idle' | 'searching' | 'failed' | 'done';

const EMPTY_MESSAGES: Record<SearchStatus, string> = {
  idle: 'Type to search.',
  searching: 'Searching…',
  failed: 'Search failed. Try again in a moment.',
  done: 'Nothing matches. Try part of an email or a route path.',
};

/** Case-insensitive "every word of the query appears in the text" (pure; tested). */
export function matchesQuery(text: string, query: string): boolean {
  const haystack = text.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/** True when focus is in a field where "/" is text, not a shortcut. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * WHY: the fastest way anywhere — Ctrl+K (⌘K, or "/") opens one box that finds pages,
 * applications, users (by email) and API routes, and switches the time range. Every result is a
 * link built from opaque ids (PAGES) and carries the current filters. The typed text stays in
 * React state; the user search goes in a POST body, never in a URL (ADR 0006).
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const combo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
      const slash = event.key === '/' && !isTypingTarget(event.target);
      if (!combo && !slash) return;
      event.preventDefault();
      setOpen((current) => (combo ? !current : true));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 w-full max-w-64 cursor-pointer items-center gap-2 rounded-lg bg-muted/60 px-2.5 text-xs text-muted-foreground ring-1 ring-border transition-colors ring-inset outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
        aria-keyshortcuts="Control+K Meta+K"
      >
        <Search className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="flex-1 truncate text-left">Search pages, apps, users, routes…</span>
        <kbd className="hidden rounded border border-border bg-background px-1.5 font-mono text-[10px] sm:inline">
          Ctrl K
        </kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        {open ? <PaletteDialog onClose={() => setOpen(false)} /> : null}
      </Dialog>
    </>
  );
}

function PaletteDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const listId = useId();
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const { items, status } = usePaletteItems(text);
  const activeIndex = Math.min(active, Math.max(0, items.length - 1));

  const choose = useCallback(
    (item: PaletteItem | undefined) => {
      if (!item) return;
      onClose();
      if (item.href) router.push(item.href);
      else item.run?.();
    },
    [onClose, router],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((activeIndex + 1) % Math.max(1, items.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((activeIndex - 1 + items.length) % Math.max(1, items.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(items[activeIndex]);
    }
  };

  return (
    <DialogContent
      hideClose
      className="top-[15vh] max-w-xl translate-y-0 gap-0 overflow-hidden p-0"
    >
      <DialogTitle className="sr-only">Search</DialogTitle>
      <DialogDescription className="sr-only">
        Find a page, an application, a user or an API route. Use the arrow keys and Enter.
      </DialogDescription>
      <div className="flex items-center gap-2 border-b border-border px-4">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          autoFocus
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search pages, apps, users by email, API routes…"
          className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={items[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          aria-autocomplete="list"
          aria-label="Search"
        />
      </div>
      <PaletteResults
        listId={listId}
        items={items}
        activeIndex={activeIndex}
        onHover={setActive}
        onChoose={choose}
        status={status}
      />
      <p className="flex items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        <span>↑↓ to move</span>
        <span className="inline-flex items-center gap-1">
          <CornerDownLeft className="size-3" aria-hidden="true" /> to open
        </span>
        <span>Esc to close</span>
      </p>
    </DialogContent>
  );
}

function PaletteResults({
  listId,
  items,
  activeIndex,
  onHover,
  onChoose,
  status,
}: {
  listId: string;
  items: readonly PaletteItem[];
  activeIndex: number;
  onHover: (index: number) => void;
  onChoose: (item: PaletteItem) => void;
  status: SearchStatus;
}) {
  if (items.length === 0) {
    return (
      <p role="status" className="px-4 py-10 text-center text-sm text-muted-foreground">
        {EMPTY_MESSAGES[status]}
      </p>
    );
  }
  return (
    <ul
      id={listId}
      role="listbox"
      aria-label="Results"
      className="max-h-[50vh] overflow-y-auto p-2"
    >
      {items.map((item, index) => {
        const first = index === 0 || items[index - 1]?.group !== item.group;
        return (
          <li key={item.id} role="presentation">
            {first ? (
              <p
                role="presentation"
                className="px-2 pt-2 pb-1 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase"
              >
                {item.group}
              </p>
            ) : null}
            <div
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              aria-label={item.sublabel ? `${item.text}, ${item.sublabel}` : item.text}
              onMouseMove={() => onHover(index)}
              onClick={() => onChoose(item)}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm',
                index === activeIndex ? 'bg-accent text-accent-foreground' : 'text-foreground',
              )}
            >
              <span className="flex size-6 shrink-0 items-center justify-center text-muted-foreground">
                {item.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{item.label}</span>
                {item.sublabel ? (
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {item.sublabel}
                  </span>
                ) : null}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Every result for `text`, in display order: pages, apps, users, routes, range actions. */
function usePaletteItems(text: string): { items: PaletteItem[]; status: SearchStatus } {
  const { filters, setRange } = useGlobalFilters();
  const linkQuery = useMemo(() => filterLinkQuery(filters), [filters]);
  const query = text.trim();
  const settled = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const serverSearch = settled.length >= MIN_SERVER_SEARCH;

  const apps = useAppList();
  const users = useUserSearch(
    { ...filters, search: settled, limit: GROUP_LIMIT },
    { enabled: serverSearch },
  );
  // Routes need percentiles: over a too-long range the search simply returns nothing.
  const routes = useEndpointStats({
    ...filters,
    sort: 'calls',
    dir: 'desc',
    search: serverSearch ? settled : undefined,
    limit: GROUP_LIMIT,
  });

  const items = useMemo(() => {
    const pages: PaletteItem[] = NAV_ITEMS.filter((item) =>
      matchesQuery(`${item.label} ${item.description}`, query),
    ).map((item) => {
      const Icon = item.icon;
      return {
        id: `page:${item.id}`,
        group: 'Pages',
        label: item.label,
        text: item.label,
        sublabel: item.description,
        icon: <Icon className="size-4" aria-hidden="true" />,
        href: withQuery(item.href, item.filters.app ? linkQuery : { ...linkQuery, app: undefined }),
      };
    });

    const appItems: PaletteItem[] = (apps.data ?? [])
      .filter((app) => matchesQuery(`${app.displayName} ${app.slug}`, query))
      .map((app) => ({
        id: `app:${app.slug}`,
        group: 'Applications',
        label: app.displayName,
        text: app.displayName,
        sublabel: app.slug,
        icon: <Boxes className="size-4" aria-hidden="true" />,
        href: withQuery(PAGES.applicationDetail(app.slug), { ...linkQuery, app: undefined }),
      }));

    const userItems: PaletteItem[] = serverSearch
      ? (users.data?.pages[0]?.items ?? []).map((user) => ({
          id: `user:${user.userKey}`,
          group: 'Users',
          label: user.email,
          text: user.email,
          sublabel: user.apps.join(' · '),
          icon: <UserRound className="size-4" aria-hidden="true" />,
          href: withQuery(PAGES.userDetail(user.userKey), linkQuery),
        }))
      : [];

    const routeItems: PaletteItem[] = serverSearch
      ? (routes.data?.pages[0]?.items ?? []).map((route) => ({
          id: `route:${route.endpointId}`,
          group: 'API routes',
          label: (
            <span className="flex min-w-0 items-center gap-2">
              <MethodBadge method={route.method} />
              <span className="truncate font-mono text-xs">{route.routeTemplate}</span>
            </span>
          ),
          text: `${route.method} ${route.routeTemplate}`,
          sublabel: route.app,
          icon: <Route className="size-4" aria-hidden="true" />,
          href: withQuery(PAGES.endpointDetail(route.endpointId), linkQuery),
        }))
      : [];

    const rangeItems: PaletteItem[] = RANGE_ACTIONS.filter((range) =>
      matchesQuery(`range time ${RANGE_LABELS[range].ariaLabel} ${range}`, query),
    ).map((range) => ({
      id: `range:${range}`,
      group: 'Time range',
      label: RANGE_LABELS[range].ariaLabel,
      text: `Time range: ${RANGE_LABELS[range].ariaLabel}`,
      sublabel: filters.range === range ? 'current' : undefined,
      icon: <CalendarRange className="size-4" aria-hidden="true" />,
      run: () => setRange(range),
    }));

    return [...pages, ...appItems, ...userItems, ...routeItems, ...rangeItems];
  }, [query, apps.data, users.data, routes.data, serverSearch, linkQuery, filters.range, setRange]);

  const status: SearchStatus = !serverSearch
    ? query === settled || query.length < MIN_SERVER_SEARCH
      ? 'idle'
      : 'searching'
    : users.isFetching || routes.isFetching
      ? 'searching'
      : users.isError || routes.isError
        ? 'failed'
        : 'done';
  return { items, status };
}
