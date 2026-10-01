import { endpointDetailParamsSchema } from '@nexus/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { EndpointDetailView } from '@/features/endpoints/EndpointDetailView';

export const metadata: Metadata = { title: 'Route' };

/**
 * PAGES.endpointDetail(endpointId) — @see ../../../../features/endpoints/EndpointDetailView.tsx
 * The id is validated with the API's own params schema (uuid): anything else is a 404 here
 * instead of a 400 from the API.
 */
export default async function EndpointDetailPage({
  params,
}: {
  params: Promise<{ endpointId: string }>;
}) {
  const parsed = endpointDetailParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  return <EndpointDetailView endpointId={parsed.data.endpointId} />;
}
