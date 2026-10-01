import type { ActorDto } from '@nexus/shared';

import { ClaimedBadge } from '@/components/ClaimedBadge';

/** "Mumbai, IN" from the approximate geo, or null. */
function placeOf(actor: ActorDto): string | null {
  const parts = [actor.geo?.city, actor.geo?.country].filter((part): part is string => !!part);
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * WHY: who made a request, shown with its trust level — a verified email, a flagged browser
 * claim, or anonymous. The IP appears ONLY when the API sent one (admins; the mapper nulls it for
 * everyone else). Every value is rendered as text, never as a link.
 */
export function ActorCell({ actor }: { actor: ActorDto }) {
  const place = placeOf(actor);
  const secondary = [actor.ip, place].filter((part): part is string => !!part).join(' · ');
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {actor.userEmail ? (
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
