'use client';

import { useEffect } from 'react';

/** Suffix of every tab title (matches the root layout's metadata title template). */
export const TITLE_SUFFIX = 'Traffic · Data Nexus';

/**
 * WHY: detail pages render client-side, so the static page title cannot name the route, user or
 * session — with ten tabs open they would all read the same. Pass ONLY non-sensitive text (a route
 * template, an app slug, a masked email): tab titles end up in browser history.
 */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title} · ${TITLE_SUFFIX}`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

/** "s***@libas.in" — enough to recognise a tab, not enough to leak the address. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}
