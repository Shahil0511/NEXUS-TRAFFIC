import { Globe2 } from 'lucide-react';
import type { Metadata } from 'next';

import { ComingSoon } from '@/components/ComingSoon';

export const metadata: Metadata = { title: 'Geography' };

const HIGHLIGHTS = [
  'Requests and users per country with a ranked bar chart',
  'Approximate cities, with the MaxMind GeoLite2 attribution',
] as const;

/** PAGES.geography() — placeholder until S3 delivers its data (@see ../../../lib/nav.ts comingIn). */
export default function GeographyPage() {
  return <ComingSoon title="Geography" step="S3" icon={Globe2} highlights={HIGHLIGHTS} />;
}
