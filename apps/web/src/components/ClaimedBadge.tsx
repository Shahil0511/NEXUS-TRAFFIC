import { ShieldQuestion } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

/**
 * WHY: a `client_claimed` identity is only a browser hint that anyone with the publishable key can
 * forge (ADR 0001 "Identity"). It is shown, but always flagged, and never counted as a user.
 */
export function ClaimedBadge() {
  return (
    <Badge
      variant="outline"
      title="Claimed by the browser, not verified by SSO or the app backend"
      aria-label="claimed identity, not verified"
    >
      <ShieldQuestion aria-hidden="true" />
      claimed
    </Badge>
  );
}
