import type { ActorDto } from '@nexus/shared';
import Link from 'next/link';

import { ClaimedBadge } from '@/components/ClaimedBadge';
import { PAGES, withQuery } from '@/lib/pages';

/** "Mumbai, IN" from the approximate geo, or null. */
function placeOf(actor: ActorDto): string | null {
  const parts = [actor.geo?.city, actor.geo?.country].filter((part): part is string => !!part);
  return parts.length > 0 ? parts.join(', ') : null;
}

export interface UserLinkProps {
  /** Opaque user id (HMAC); the link is built from it, never from the email. */
  userKey: string;
  email: string;
  /** The current filters to carry (filterLinkQuery). */
  linkQuery?: Readonly<Record<string, string | undefined>>;
}

/** WHY: a verified user's email opens their page — the URL carries only the opaque userKey. */
export function UserLink({ userKey, email, linkQuery = {} }: UserLinkProps) {
  return (
    <Link
      href={withQuery(PAGES.userDetail(userKey), linkQuery)}
      className="truncate rounded-sm underline-offset-2 outline-none hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      {email}
    </Link>
  );
}

/**
 * WHY: who made a request, shown with its trust level — a verified email (a link to the user's
 * page when `linkQuery` is given and the API sent the opaque userKey), a flagged browser claim
 * (text, never a link: claims are not users), or anonymous. The IP appears ONLY when the API sent
 * one (admins; the mapper nulls it for everyone else).
 */
export function ActorCell({
  actor,
  linkQuery,
}: {
  actor: ActorDto;
  linkQuery?: Readonly<Record<string, string | undefined>>;
}) {
  const place = placeOf(actor);
  const secondary = [actor.ip, place].filter((part): part is string => !!part).join(' · ');
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {actor.userEmail && actor.userKey && linkQuery ? (
        <UserLink userKey={actor.userKey} email={actor.userEmail} linkQuery={linkQuery} />
      ) : actor.userEmail ? (
        <span className="truncate">{actor.userEmail}</span>
      ) : actor.claimedEmail ? (
        <span className="flex items-center gap-1.5">
          <span className="truncate text-muted-foreground">{actor.claimedEmail}</span>
          <ClaimedBadge />
        </span>
      ) : (
        <span className="text-muted-foreground italic">anonymous</span>
      )}
      {secondary ? (
        <span className="truncate font-mono text-[11px] text-muted-foreground">{secondary}</span>
      ) : null}
    </div>
  );
}
