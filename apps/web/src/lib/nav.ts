/**
 * The sidebar navigation, built from PAGES, and the global filters each page uses.
 *
 * WHY: one ordered list drives the sidebar (and its "coming in" badges) so adding a page is a
 * one-line change here plus its PAGES entry. `comingIn` marks pages whose data arrives in a later
 * step; their page files render the ComingSoon state until then. `filters` tells the top bar which
 * global filters the page actually reads, so a control is never shown where it does nothing and a
 * range the page's queries refuse (RANGE_TOO_LARGE) cannot be picked.
 */
import { MAX_COUNT_RANGE_MS, MAX_PERCENTILE_RANGE_MS } from '@nexus/shared';
import {
  Activity,
  AppWindow,
  Boxes,
  Globe2,
  LayoutDashboard,
  type LucideIcon,
  MousePointerClick,
  PlugZap,
  Route,
  TriangleAlert,
  Users,
  Waypoints,
} from 'lucide-react';

import { PAGES } from './pages';

export type DeliveryStep = 'S3' | 'S4' | 'S5';

/** The global filters a page reads (top bar). */
export interface PageFilters {
  /** The app filter; off on pages that are about every app or one fixed app. */
  app: boolean;
  /** The time range; off on pages without a window (Live, Integration, Apps). */
  range: boolean;
  /** Longest window the page's queries accept (the API's range cap of its cost class). */
  maxRangeMs: number;
}

/** Count-only pages (users, tools, geography): the API accepts up to MAX_COUNT_RANGE_MS. */
const COUNT_PAGE: PageFilters = { app: true, range: true, maxRangeMs: MAX_COUNT_RANGE_MS };
/** Pages with latency/time percentiles: the API caps them at MAX_PERCENTILE_RANGE_MS. */
const PERCENTILE_PAGE: PageFilters = {
  app: true,
  range: true,
  maxRangeMs: MAX_PERCENTILE_RANGE_MS,
};

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** One line shown in the command palette. */
  description: string;
  filters: PageFilters;
  /** Set while the page is still a placeholder. */
  comingIn?: DeliveryStep;
  /** Other page hrefs that highlight this item (Pages & Tools covers two pages). */
  alsoActiveOn?: readonly string[];
}

export interface NavSection {
  id: string;
  label: string;
  items: readonly NavItem[];
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    id: 'monitor',
    label: 'Monitor',
    items: [
      {
        id: 'overview',
        label: 'Overview',
        href: PAGES.overview(),
        icon: LayoutDashboard,
        description: 'Headline numbers, traffic, errors and latency',
        filters: PERCENTILE_PAGE,
      },
      {
        id: 'applications',
        label: 'Applications',
        href: PAGES.applications(),
        icon: Boxes,
        description: 'Every app side by side: traffic, errors, users',
        filters: { ...PERCENTILE_PAGE, app: false },
      },
      {
        id: 'live',
        label: 'Live',
        href: PAGES.live(),
        icon: Activity,
        description: 'Events as they happen',
        filters: { ...COUNT_PAGE, range: false },
      },
    ],
  },
  {
    id: 'backend',
    label: 'Backend',
    items: [
      {
        id: 'endpoints',
        label: 'API Routes',
        href: PAGES.endpoints(),
        icon: Route,
        description: 'Calls, error rate and latency per route',
        filters: PERCENTILE_PAGE,
      },
      {
        id: 'errors',
        label: 'Errors',
        href: PAGES.errors(),
        icon: TriangleAlert,
        description: 'Failed requests, status codes, failing routes',
        filters: PERCENTILE_PAGE,
      },
    ],
  },
  {
    id: 'frontend',
    label: 'Frontend',
    items: [
      {
        id: 'users',
        label: 'Users',
        href: PAGES.users(),
        icon: Users,
        description: 'Who uses which app, and how much',
        filters: COUNT_PAGE,
      },
      {
        id: 'journeys',
        label: 'Journeys',
        href: PAGES.journeys(),
        icon: Waypoints,
        description: 'Browser sessions and common paths',
        filters: PERCENTILE_PAGE,
      },
      {
        id: 'pages',
        label: 'Pages & Tools',
        href: PAGES.pages(),
        icon: MousePointerClick,
        description: 'Most viewed pages, time on page, tool usage',
        filters: PERCENTILE_PAGE,
        alsoActiveOn: [PAGES.tools()],
      },
      {
        id: 'geography',
        label: 'Geography',
        href: PAGES.geography(),
        icon: Globe2,
        description: 'Where traffic comes from',
        filters: COUNT_PAGE,
      },
    ],
  },
  {
    id: 'admin',
    label: 'Setup',
    items: [
      {
        id: 'integration',
        label: 'Integration',
        href: PAGES.integration(),
        icon: PlugZap,
        description: 'Is every app sending data?',
        filters: { ...COUNT_PAGE, app: false, range: false },
      },
      {
        id: 'apps',
        label: 'Apps',
        href: PAGES.apps(),
        icon: AppWindow,
        description: 'Register apps and manage keys',
        filters: { ...COUNT_PAGE, app: false, range: false },
      },
    ],
  },
];

/** Flat list (tests, command palette). */
export const NAV_ITEMS: readonly NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

/** Whether `pathname` (without basePath) belongs to a nav item; the overview matches exactly. */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.href === PAGES.overview()) return pathname === item.href;
  return [item.href, ...(item.alsoActiveOn ?? [])].some(
    (href) => pathname === href || pathname.startsWith(`${href}/`),
  );
}

/** The nav item a pathname belongs to (detail pages belong to their list), or undefined. */
export function activeNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => isNavItemActive(item, pathname));
}

/** The global filters of the page at `pathname`; unknown pages get every filter. */
export function pageFiltersFor(pathname: string): PageFilters {
  return activeNavItem(pathname)?.filters ?? COUNT_PAGE;
}
