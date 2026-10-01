import { ShieldX } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { loadWebEnv } from '@/env.schema';

/** The portal home (PUBLIC_ORIGIN), or null when the env is incomplete — never a 500 here. */
function portalHome(): string | null {
  try {
    return loadWebEnv().PUBLIC_ORIGIN;
  } catch {
    return null;
  }
}

/**
 * WHY: what a signed-in user who is NOT on the dashboard access policy sees (rendered by
 * src/app/forbidden.tsx with HTTP 403). No shell and no API calls: they would all answer 403.
 * The only link is the portal home from env (PUBLIC_ORIGIN), never request data.
 */
export function NoAccess() {
  const home = portalHome();
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md space-y-4 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <ShieldX className="size-6" aria-hidden="true" />
        </span>
        <h1 className="text-xl font-semibold tracking-tight">You do not have access to Traffic</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          You are signed in to the Data Nexus portal, but your account is not on the access list of
          the Traffic dashboard. Ask the Data Nexus team to add you.
        </p>
        {home ? (
          <Button asChild variant="outline">
            <a href={home}>Back to the portal</a>
          </Button>
        ) : null}
      </div>
    </main>
  );
}
