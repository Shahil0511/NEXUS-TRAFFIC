/**
 * The decorative art of the dashboard: one hero motif per nav item, and the state art (empty,
 * error, locked, not found). Inline SVG drawn with token colours, so both themes work.
 *
 * WHY a Record<NavItemId, …>: a new nav item without its motif fails the typecheck; the page hero
 * (components/PageHeader.tsx) looks the motif up by the active nav item and shows it on list pages
 * only (detail pages keep the section's icon tile; their long title needs the width). ADR 0016.
 * @see ../PageHeader.tsx
 */
import type { ComponentType } from 'react';

import type { NavItemId } from '@/lib/nav';

import { AppsIllustration } from './AppsIllustration';
import { ChartsIllustration } from './ChartsIllustration';
import { CompassIllustration } from './CompassIllustration';
import { DataHealthIllustration } from './DataHealthIllustration';
import { DevicesIllustration } from './DevicesIllustration';
import { EmptyBoxIllustration } from './EmptyBoxIllustration';
import type { IllustrationProps } from './IllustrationFrame';
import { KeysIllustration } from './KeysIllustration';
import { LockIllustration } from './LockIllustration';
import { PagesIllustration } from './PagesIllustration';
import { PathIllustration } from './PathIllustration';
import { PeopleIllustration } from './PeopleIllustration';
import { ProblemsIllustration } from './ProblemsIllustration';
import { PulseIllustration } from './PulseIllustration';
import { RequestsIllustration } from './RequestsIllustration';
import { ShieldIllustration } from './ShieldIllustration';
import { WarningCloudIllustration } from './WarningCloudIllustration';

export type { IllustrationProps } from './IllustrationFrame';
export { CompassIllustration, EmptyBoxIllustration, LockIllustration, WarningCloudIllustration };

export type Illustration = ComponentType<IllustrationProps>;

/**
 * The state art (components/StateArt.tsx scenes), by name. WHY a record: the illustration tests
 * iterate it, so a new state scene added here is checked like every other one.
 */
export const STATE_ILLUSTRATIONS: Readonly<Record<string, Illustration>> = {
  EmptyBoxIllustration,
  WarningCloudIllustration,
  LockIllustration,
  CompassIllustration,
};

/** The hero motif of every nav item (and of the detail pages under it). */
export const NAV_ILLUSTRATIONS: Readonly<Record<NavItemId, Illustration>> = {
  overview: ChartsIllustration,
  live: PulseIllustration,
  users: PeopleIllustration,
  journeys: PathIllustration,
  devices: DevicesIllustration,
  applications: AppsIllustration,
  pages: PagesIllustration,
  endpoints: RequestsIllustration,
  errors: ProblemsIllustration,
  integration: DataHealthIllustration,
  apps: KeysIllustration,
  privacy: ShieldIllustration,
};
