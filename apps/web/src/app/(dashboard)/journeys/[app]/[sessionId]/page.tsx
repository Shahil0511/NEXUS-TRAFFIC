import { sessionParamsSchema } from '@nexus/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { SessionDetailView } from '@/features/journeys/SessionDetailView';

export const metadata: Metadata = { title: 'Session' };

/**
 * PAGES.sessionDetail(app, sessionId) — @see ../../../../../features/journeys/SessionDetailView.tsx
 * Both segments are validated with the API's own params schema (app slug + uuid): anything else
 * is a 404 here instead of a 400 from the API.
 */
export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ app: string; sessionId: string }>;
}) {
  const parsed = sessionParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  return <SessionDetailView app={parsed.data.app} sessionId={parsed.data.sessionId} />;
}
