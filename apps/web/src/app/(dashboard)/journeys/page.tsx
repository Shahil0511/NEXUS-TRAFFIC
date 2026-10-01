import { Waypoints } from 'lucide-react';
import type { Metadata } from 'next';

import { ComingSoon } from '@/components/ComingSoon';

export const metadata: Metadata = { title: 'Journeys' };

const HIGHLIGHTS = [
  'Sessions with a replay timeline: page → time spent → tools → correlated API calls',
  'The most common three-step paths through each app',
] as const;

/** PAGES.journeys() — placeholder until S3 delivers its data (@see ../../../lib/nav.ts comingIn). */
export default function JourneysPage() {
  return <ComingSoon title="Journeys" step="S3" icon={Waypoints} highlights={HIGHLIGHTS} />;
}
