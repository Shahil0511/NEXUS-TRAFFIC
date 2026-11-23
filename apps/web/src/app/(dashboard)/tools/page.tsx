import type { Metadata } from 'next';

import { ToolsView } from '@/features/tools/ToolsView';

export const metadata: Metadata = { title: 'Pages & features' };

/** PAGES.tools() — @see ../../../features/tools/ToolsView.tsx */
export default function ToolsPage() {
  return <ToolsView />;
}
