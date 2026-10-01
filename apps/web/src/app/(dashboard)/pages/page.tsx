import { MousePointerClick } from 'lucide-react';
import type { Metadata } from 'next';

import { ComingSoon } from '@/components/ComingSoon';

export const metadata: Metadata = { title: 'Pages & Tools' };

const HIGHLIGHTS = [
  'Time on page: views, average and median visible time, exits',
  'Tool usage: uses, distinct users and trend per tool',
] as const;

/** PAGES.pages() — placeholder until S3 delivers its data (@see ../../../lib/nav.ts comingIn). */
export default function PagesPage() {
  return (
    <ComingSoon title="Pages & Tools" step="S3" icon={MousePointerClick} highlights={HIGHLIGHTS} />
  );
}
