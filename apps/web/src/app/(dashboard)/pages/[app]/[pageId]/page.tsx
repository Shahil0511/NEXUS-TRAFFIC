import { pageDetailParamsSchema } from '@nexus/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PageDetailView } from '@/features/pages/PageDetailView';

export const metadata: Metadata = { title: 'Page' };

/**
 * PAGES.pageDetail(app, pageId) — @see ../../../../../features/pages/PageDetailView.tsx
 * Validated with the API's own params schema (registered slug pattern + uuid): anything else is a
 * 404 here instead of a 400 from the API.
 */
export default async function PageDetailPage({
  params,
}: {
  params: Promise<{ app: string; pageId: string }>;
}) {
  const parsed = pageDetailParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  const { app, pageId } = parsed.data;
  return <PageDetailView key={`${app}/${pageId}`} app={app} pageId={pageId} />;
}
