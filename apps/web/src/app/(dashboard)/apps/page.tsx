import { AppWindow } from 'lucide-react';
import type { Metadata } from 'next';

import { ComingSoon } from '@/components/ComingSoon';

export const metadata: Metadata = { title: 'Apps' };

const HIGHLIGHTS = [
  'Every registered app with its keys and integration status',
  'Admins: register apps, issue, expire and revoke keys (secret shown once)',
] as const;

/** PAGES.apps() — placeholder until S5 delivers its data (@see ../../../lib/nav.ts comingIn). */
export default function AppsPage() {
  return <ComingSoon title="Apps" step="S5" icon={AppWindow} highlights={HIGHLIGHTS} />;
}
