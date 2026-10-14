import { appSlugSchema } from '@nexus/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ApplicationDetailView } from '@/features/applications/ApplicationDetailView';

export const metadata: Metadata = { title: 'Application' };

/**
 * PAGES.applicationDetail(app) — @see ../../../../features/applications/ApplicationDetailView.tsx
 * The slug is validated with the API's own pattern (APP_SLUG_PATTERN): anything else is a 404
 * here; a well-formed but unregistered slug gets the API's 404 ("Unknown app").
 */
export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ app: string }>;
}) {
  const parsed = appSlugSchema.safeParse((await params).app);
  if (!parsed.success) notFound();
  // Keyed by app: switching apps remounts, so no panel shows the previous app while loading.
  return <ApplicationDetailView key={parsed.data} app={parsed.data} />;
}
