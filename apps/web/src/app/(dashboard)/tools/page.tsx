import { MousePointerClick } from 'lucide-react';
import type { Metadata } from 'next';

import { ComingSoon } from '@/components/ComingSoon';

export const metadata: Metadata = { title: 'Tools' };

const HIGHLIGHTS = [
  'Tool usage per app: uses, distinct users and trend',
  'Auto-captured from data-nexus-tool clicks plus manual trackTool() calls',
] as const;

/** PAGES.tools() — placeholder until S3 delivers its data (@see ../../../lib/nav.ts comingIn). */
export default function ToolsPage() {
  return <ComingSoon title="Tools" step="S3" icon={MousePointerClick} highlights={HIGHLIGHTS} />;
}
