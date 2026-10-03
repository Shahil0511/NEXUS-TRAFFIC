import type { Metadata } from 'next';

import { LiveView } from '@/features/live/LiveView';

export const metadata: Metadata = { title: 'Live' };

/** PAGES.live() — @see ../../../features/live/LiveView.tsx */
export default function LivePage() {
  return <LiveView />;
}
