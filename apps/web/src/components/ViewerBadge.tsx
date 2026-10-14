'use client';

import { ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/features/me/useMe';

/** "shahil.jha@libas.in" → "SJ" for the avatar circle. */
export function initialsOf(email: string): string {
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0]![0]}${parts[1]![0]}` : local.slice(0, 2);
  return letters.toUpperCase();
}

/**
 * WHY: who is signed in, and whether they are an admin (admins manage apps/keys and see IPs).
 * The email comes from api.me.get — the API's own verification of the SSO cookie — not from a
 * client-side decode of the token. Below lg only the initials are drawn (the email stays readable
 * by screen readers), below sm the admin badge shrinks to its icon.
 */
export function ViewerBadge() {
  const me = useMe();
  if (me.isPending) {
    return (
      <div className="flex items-center gap-2" aria-busy="true" aria-label="Loading your account">
        <Skeleton className="size-7 rounded-full" />
        <Skeleton className="hidden h-4 w-28 lg:block" />
      </div>
    );
  }
  if (me.isError) return null;
  const { email, isAdmin } = me.data;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-2xs font-semibold text-accent-foreground"
      >
        {initialsOf(email)}
      </span>
      {/* Read once by screen readers at every width; the visible copy below is decoration. */}
      <span className="sr-only">Signed in as {email}</span>
      <span
        aria-hidden="true"
        className="hidden max-w-44 min-w-0 truncate text-xs font-medium lg:block"
      >
        {email}
      </span>
      {isAdmin ? (
        <Badge variant="default" title="Admin: manages apps and keys, sees IP addresses">
          <ShieldCheck aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">admin</span>
        </Badge>
      ) : null}
    </div>
  );
}
