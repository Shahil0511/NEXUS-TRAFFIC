import { userKeyParamsSchema } from '@nexus/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { UserDetailView } from '@/features/users/UserDetailView';

export const metadata: Metadata = { title: 'User' };

/**
 * PAGES.userDetail(userKey) — @see ../../../../features/users/UserDetailView.tsx
 * The key is validated with the API's own params schema (64 hex chars): anything else is a 404
 * here instead of a 400 from the API.
 */
export default async function UserDetailPage({ params }: { params: Promise<{ userKey: string }> }) {
  const parsed = userKeyParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  return <UserDetailView userKey={parsed.data.userKey} />;
}
