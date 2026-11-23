'use client';

import { useMe } from './useMe';

/**
 * WHY: a person's page (and any list narrowed to one person) is admin-only — the API answers 403
 * to everyone else. Links to it are shown ONLY when this is true, so a viewer is never sent to a
 * page that refuses them. False while the viewer is still unknown (no link flashes in and out).
 * Chain: useMe → api.me.get → ROUTES.me.get.
 */
export function useCanOpenPersonPages(): boolean {
  return useMe().data?.isAdmin === true;
}
