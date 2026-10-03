/**
 * The sidebar navigation, built from PAGES.
 *
 * WHY: one ordered list drives the sidebar (and its "coming in" badges) so adding a page is a
 * one-line change here plus its PAGES entry. `comingIn` marks pages whose data arrives in a later
 * step; their page files render the ComingSoon state until then.
 */
import {
  Activity,
  AppWindow,
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

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
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
      { id: 'overview', label: 'Overview', href: PAGES.overview(), icon: LayoutDashboard },
      { id: 'live', label: 'Live', href: PAGES.live(), icon: Activity },
    ],
  },
  {
    id: 'backend',
    label: 'Backend',
    items: [
      { id: 'endpoints', label: 'API Routes', href: PAGES.endpoints(), icon: Route },
      { id: 'errors', label: 'Errors', href: PAGES.errors(), icon: TriangleAlert },
    ],
  },
  {
    id: 'frontend',
    label: 'Frontend',
    items: [
      { id: 'users', label: 'Users', href: PAGES.users(), icon: Users },
      {
        id: 'journeys',
        label: 'Journeys',
        href: PAGES.journeys(),
        icon: Waypoints,
      },
      {
        id: 'pages',
        label: 'Pages & Tools',
        href: PAGES.pages(),
        icon: MousePointerClick,
        alsoActiveOn: [PAGES.tools()],
      },
      {
        id: 'geography',
        label: 'Geography',
        href: PAGES.geography(),
        icon: Globe2,
      },
    ],
  },
  {
    id: 'admin',
    label: 'Setup',
    items: [
      { id: 'integration', label: 'Integration', href: PAGES.integration(), icon: PlugZap },
      { id: 'apps', label: 'Apps', href: PAGES.apps(), icon: AppWindow },
    ],
  },
];

/** Flat list (tests, command palettes). */
export const NAV_ITEMS: readonly NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

/** Whether `pathname` (without basePath) belongs to a nav item; the overview matches exactly. */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.href === PAGES.overview()) return pathname === item.href;
  return [item.href, ...(item.alsoActiveOn ?? [])].some(
    (href) => pathname === href || pathname.startsWith(`${href}/`),
  );
}
