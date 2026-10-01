import { Users } from 'lucide-react';
import type { Metadata } from 'next';

import { ComingSoon } from '@/components/ComingSoon';

export const metadata: Metadata = { title: 'Users' };

const HIGHLIGHTS = [
  'Identified users with last seen, requests and sessions',
  'A profile per user with a combined timeline of pages, tools and API calls',
  'Only verified identities count; browser claims stay flagged',
] as const;

/** PAGES.users() — placeholder until S3 delivers its data (@see ../../../lib/nav.ts comingIn). */
export default function UsersPage() {
  return <ComingSoon title="Users" step="S3" icon={Users} highlights={HIGHLIGHTS} />;
}
