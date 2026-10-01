import type { ReactNode } from 'react';

import { AppShell } from '@/components/AppShell';

/**
 * Layout of every signed-in page (the route group adds no URL segment): the sidebar + top bar
 * frame. /no-access and /healthz live outside the group and render without it.
 */
export default function DashboardLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <AppShell>{children}</AppShell>;
}
