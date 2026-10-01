import { PlugZap } from 'lucide-react';
import type { Metadata } from 'next';

import { ComingSoon } from '@/components/ComingSoon';

export const metadata: Metadata = { title: 'Integration' };

const HIGHLIGHTS = [
  'Per app: last event per source, SDK versions and accepted / rejected counts',
  'Warnings for exposed secret keys and proxy IPs (trustProxyHops)',
] as const;

/** PAGES.integration() — placeholder until S5 delivers its data (@see ../../../lib/nav.ts comingIn). */
export default function IntegrationPage() {
  return <ComingSoon title="Integration" step="S5" icon={PlugZap} highlights={HIGHLIGHTS} />;
}
