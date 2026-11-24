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
  ShieldCheck,
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
  /**
   * The environment filter (ADR 0008); on for every windowed analytics page, off where the page
   * is production-only (Live) or deliberately unfiltered (Integration shows the mix; Apps).
   */
  environment: boolean;
  /** Longest window the page's queries accept (the API's range cap of its cost class). */
  maxRangeMs: number;
}

/** Count-only pages (users, tools, devices & places): the API accepts up to MAX_COUNT_RANGE_MS. */
const COUNT_PAGE: PageFilters = {
  app: true,
  range: true,
  environment: true,
  maxRangeMs: MAX_COUNT_RANGE_MS,
};
/** Pages with latency/time percentiles: the API caps them at MAX_PERCENTILE_RANGE_MS. */
const PERCENTILE_PAGE: PageFilters = {
  app: true,
  range: true,
  environment: true,
  maxRangeMs: MAX_PERCENTILE_RANGE_MS,
};

/**
 * Every nav item id. WHY a union: maps keyed by page (the hero illustrations in
 * components/illustrations) are Record<NavItemId, …>, so a new page without its entry fails the
 * typecheck instead of rendering a blank hero.
 */
export type NavItemId =
  | 'overview'
  | 'live'
  | 'users'
  | 'journeys'
  | 'devices'
  | 'applications'
  | 'pages'
  | 'endpoints'
  | 'errors'
  | 'integration'
  | 'apps'
  | 'privacy';

export interface NavItem {
  id: NavItemId;
  label: string;
  href: string;
  icon: LucideIcon;
  /** One line shown in the command palette (keeps the old names searchable). */
  description: string;
  /** The page's purpose in one sentence, printed under its title (English). */
  question: string;
  filters: PageFilters;
  /** Set while the page is still a placeholder. */
  comingIn?: DeliveryStep;
  /** Other page hrefs that highlight this item (Pages & Tools, Devices & places cover two pages). */
  alsoActiveOn?: readonly string[];
}

export interface NavSection {
  id: string;
  /** Group heading in the sidebar; '' for the top group (no heading). */
  label: string;
  items: readonly NavItem[];
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    id: 'monitor',
    label: '',
    items: [
      {
        id: 'overview',
        label: 'Overview',
        href: PAGES.overview(),
        icon: LayoutDashboard,
        description: 'Headline numbers, traffic, errors and latency',
        question: 'What needs my attention?',
        filters: PERCENTILE_PAGE,
      },
      {
        id: 'live',
        label: 'Live',
        href: PAGES.live(),
        icon: Activity,
        description: 'Events as they happen',
        question: 'What is happening in the apps right now?',
        // Live is production-only by design (ADR 0008): no environment filter.
        filters: { ...COUNT_PAGE, range: false, environment: false },
      },
    ],
  },
  {
    id: 'people',
    label: 'People',
    items: [
      {
        id: 'users',
        label: 'People',
        href: PAGES.users(),
        icon: Users,
        description: 'Who uses which app, and how much',
        question: 'Everyone who uses our apps, and how much.',
        filters: COUNT_PAGE,
      },
      {
        id: 'journeys',
        label: 'Visits',
        href: PAGES.journeys(),
        icon: Waypoints,
        description: 'Browser visits (sessions) and common paths',
        question: 'Every visit to the apps, newest first, and the paths people take.',
        filters: PERCENTILE_PAGE,
      },
      {
        id: 'devices',
        label: 'Devices & places',
        href: PAGES.devices(),
        icon: Globe2,
        description: 'Devices, browsers, systems and locations',
        question: 'What do people connect with, and from where?',
        filters: COUNT_PAGE,
        alsoActiveOn: [PAGES.geography()],
      },
    ],
  },
  {
    id: 'apps',
    label: 'Apps',
    items: [
      {
        id: 'applications',
        label: 'Apps',
        href: PAGES.applications(),
        icon: Boxes,
        description: 'Every app side by side: traffic, errors, users',
        question: 'How much is each app used, and is it healthy?',
        filters: { ...PERCENTILE_PAGE, app: false },
      },
      {
        id: 'pages',
        label: 'Pages & features',
        href: PAGES.pages(),
        icon: MousePointerClick,
        description: 'Most viewed pages, time on page, feature (tool) usage',
        question: 'Which pages and buttons are used, and for how long?',
        filters: PERCENTILE_PAGE,
        alsoActiveOn: [PAGES.tools()],
      },
      {
        id: 'endpoints',
        label: 'Request types',
        href: PAGES.endpoints(),
        icon: Route,
        description: 'API routes: calls, error rate and latency per route',
        question: 'Which server requests (API routes) are called, and how fast are they?',
        filters: PERCENTILE_PAGE,
      },
      {
        id: 'errors',
        label: 'Problems',
        href: PAGES.errors(),
        icon: TriangleAlert,
        description: 'Failed requests, status codes, failing routes',
        question: 'What failed, where, and for whom?',
        filters: PERCENTILE_PAGE,
      },
    ],
  },
  {
    id: 'admin',
    label: 'Setup',
    items: [
      {
        id: 'integration',
        label: 'Data health',
        href: PAGES.integration(),
        icon: PlugZap,
        description: 'Integration: is every app sending data?',
        question: 'Is every app sending complete data?',
        filters: { ...COUNT_PAGE, app: false, range: false, environment: false },
      },
      {
        id: 'apps',
        label: 'App keys',
        href: PAGES.apps(),
        icon: AppWindow,
        description: 'Register apps and manage keys',
        question: 'Register apps and manage their keys.',
        filters: { ...COUNT_PAGE, app: false, range: false, environment: false },
      },
      {
        id: 'privacy',
        label: 'Privacy & access',
        href: PAGES.privacy(),
        icon: ShieldCheck,
        description: 'Access log of person pages (admins only) and what the dashboard records',
        question: 'Who opened whose person page, and when.',
        // The log is not windowed: no app, range or environment filter.
        filters: { ...COUNT_PAGE, app: false, range: false, environment: false },
      },
    ],
  },
];

/** Flat list (tests, command palette). */
export const NAV_ITEMS: readonly NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

/**
 * The sidebar label of a page. WHY: on-screen copy that sends the reader to another page ("issue a
 * new key on the App keys page") reads the name here, so it cannot drift from the sidebar again.
 */
export function navLabel(id: NavItemId): string {
  const item = NAV_ITEMS.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`No nav item ${id}`);
  return item.label;
}

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
