import { PUBLIC_BASE_PATH } from '@nexus/shared';
import type { Metadata } from 'next';

import { loadWebEnv } from '@/env.schema';
import { AppsView } from '@/features/apps/AppsView';

export const metadata: Metadata = { title: 'Apps' };

/**
 * What teams set as NEXUS_URL (`https://nexus.libas.in/traffic`), from the SERVER env — only the
 * public origin crosses to the client, never a secret. Null when the env is incomplete.
 */
function publicNexusUrl(): string | null {
  try {
    return `${loadWebEnv().PUBLIC_ORIGIN}${PUBLIC_BASE_PATH}`;
  } catch {
    return null;
  }
}

/** PAGES.apps() — @see ../../../features/apps/AppsView.tsx */
export default function AppsPage() {
  return <AppsView nexusUrl={publicNexusUrl()} />;
}
