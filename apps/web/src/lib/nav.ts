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

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** One line shown in the command palette (keeps the old names searchable). */
  description: string;
  /** The page's purpose in one sentence, printed under its title (English). */
  question: string;
  /** The same sentence in simple Hinglish, printed under the English one. */
  questionHi: string;
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
        questionHi: 'Kya dekhna zaroori hai?',
        filters: PERCENTILE_PAGE,
      },
      {
        id: 'live',
        label: 'Live',
        href: PAGES.live(),
        icon: Activity,
        description: 'Events as they happen',
        question: 'What is happening in the apps right now?',
        questionHi: 'Abhi apps mein kya chal raha hai?',
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
        questionHi: 'Kaun-kaun use karta hai, aur kitna.',
        filters: COUNT_PAGE,
      },
      {
        id: 'journeys',
        label: 'Visits',
        href: PAGES.journeys(),
        icon: Waypoints,
        description: 'Browser visits (sessions) and common paths',
        question: 'Every visit to the apps, newest first, and the paths people take.',
        questionHi: 'Saari visits, nayi pehle, aur log kis raaste chalte hain.',
        filters: PERCENTILE_PAGE,
      },
      {
        id: 'devices',
        label: 'Devices & places',
        href: PAGES.devices(),
        icon: Globe2,
        description: 'Devices, browsers, systems and locations',
        question: 'What do people connect with, and from where?',
        questionHi: 'Kis device aur browser se, kahan se?',
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
        questionHi: 'Kaun sa app kitna use hota hai, aur theek chal raha hai?',
        filters: { ...PERCENTILE_PAGE, app: false },
      },
      {
        id: 'pages',
        label: 'Pages & features',
        href: PAGES.pages(),
        icon: MousePointerClick,
        description: 'Most viewed pages, time on page, feature (tool) usage',
        question: 'Which pages and buttons are used, and for how long?',
        questionHi: 'App ke andar kaun se page aur button use hote hain?',
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
        questionHi: 'Kaun si request kitni baar chali, aur kitni tez?',
        filters: PERCENTILE_PAGE,
      },
      {
        id: 'errors',
        label: 'Problems',
        href: PAGES.errors(),
        icon: TriangleAlert,
        description: 'Failed requests, status codes, failing routes',
        question: 'What failed, where, and for whom?',
        questionHi: 'Kya toot raha hai, kahan, aur kiske liye?',
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
        questionHi: 'Har app theek se juda hai aur poora data bhej raha hai?',
        filters: { ...COUNT_PAGE, app: false, range: false, environment: false },
      },
      {
        id: 'apps',
        label: 'App keys',
        href: PAGES.apps(),
        icon: AppWindow,
        description: 'Register apps and manage keys',
        question: 'Register apps and manage their keys.',
        questionHi: 'Apps register karna aur unki keys (sirf admin).',
        filters: { ...COUNT_PAGE, app: false, range: false, environment: false },
      },
      {
        id: 'privacy',
        label: 'Privacy & access',
        href: PAGES.privacy(),
        icon: ShieldCheck,
        description: 'Access log of person pages (admins only) and what the dashboard records',
        question: 'Who opened whose person page, and when.',
        questionHi: 'Kisne kiska page kab khola.',
        // The log is not windowed: no app, range or environment filter.
        filters: { ...COUNT_PAGE, app: false, range: false, environment: false },
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
