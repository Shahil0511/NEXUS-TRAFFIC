/**
 * WHY: the `client.sdk` / `client.version` the collector shows on the Integration Health page.
 * Bumped together with package.json (a test asserts they match).
 */
export const SDK_NAME = '@nexus/react';
export const SDK_VERSION = '1.0.0';

/** Storage keys. Prefixed so they never collide with the host app's own keys. */
export const STORAGE_KEYS = {
  session: 'nexus.session',
  anonymousId: 'nexus.anonymousId',
} as const;
