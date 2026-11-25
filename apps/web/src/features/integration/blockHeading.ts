/**
 * WHY: an app's health blocks (Coverage, Environments, Releases, SSO cookie, per-source events)
 * sit one level below the app's name, wherever that name is: an h2 card title (AppHealthCard)
 * makes them h3, an h3 checklist row title (Data health) makes them h4. So screen-reader users
 * moving by heading land on the app first and then on its blocks.
 */
export type BlockHeading = 'h3' | 'h4';

/** The level the blocks use when the caller does not say (under an h2 card title). */
export const DEFAULT_BLOCK_HEADING: BlockHeading = 'h3';
