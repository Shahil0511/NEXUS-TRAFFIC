import { toolDetailParamsSchema } from '@nexus/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ToolDetailView } from '@/features/tools/ToolDetailView';

export const metadata: Metadata = { title: 'Tool' };

/**
 * PAGES.toolDetail(app, toolId) — @see ../../../../../features/tools/ToolDetailView.tsx
 * Validated with the API's own params schema (registered slug pattern + uuid): anything else is a
 * 404 here instead of a 400 from the API.
 */
export default async function ToolDetailPage({
  params,
}: {
  params: Promise<{ app: string; toolId: string }>;
}) {
  const parsed = toolDetailParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  const { app, toolId } = parsed.data;
  return <ToolDetailView key={`${app}/${toolId}`} app={app} toolId={toolId} />;
}
