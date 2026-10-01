import { Activity } from 'lucide-react';
import type { Metadata } from 'next';

import { ComingSoon } from '@/components/ComingSoon';

export const metadata: Metadata = { title: 'Live' };

const HIGHLIGHTS = [
  'A streaming table of API calls and page / tool events as they arrive',
  'Live tiles: requests per minute, errors, active users',
  'Pause, resume and filter by app',
] as const;

/** PAGES.live() — placeholder until S4 delivers its data (@see ../../../lib/nav.ts comingIn). */
export default function LivePage() {
  return <ComingSoon title="Live" step="S4" icon={Activity} highlights={HIGHLIGHTS} />;
}
