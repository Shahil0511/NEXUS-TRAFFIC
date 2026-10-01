/**
 * Decides who an event belongs to and how much we trust it (see IDENTITY_SOURCE_VALUES):
 * - server events: a plausible `userEmail` sent with the SECRET key → app_attested, else anonymous.
 * - browser events: a valid SSO cookie → sso_cookie; else a plausible `user.email` hint →
 *   client_claimed (claimed_email only, user_email stays null); else anonymous.
 * `dropped` = a value was supplied but was not a plausible email (→ FIELD_DROPPED warning).
 */
import { plausibleEmail } from '@nexus/auth';
import type { IdentitySource } from '@nexus/shared';

import type { SsoIdentityReader } from '../auth/sso-identity.reader';

export interface ResolvedIdentity {
  userEmail: string | null;
  claimedEmail: string | null;
  identitySource: IdentitySource;
  dropped: boolean;
}

function anonymous(dropped: boolean): ResolvedIdentity {
  return { userEmail: null, claimedEmail: null, identitySource: 'anonymous', dropped };
}

/** WHY: ONLY verified sources may fill user_email — forged browser hints must never count. */
export class IdentityResolver {
  constructor(private readonly sso: SsoIdentityReader) {}

  forServer(userEmail: string | undefined): ResolvedIdentity {
    if (userEmail === undefined) return anonymous(false);
    const email = plausibleEmail(userEmail);
    if (!email) return anonymous(true);
    return { userEmail: email, claimedEmail: null, identitySource: 'app_attested', dropped: false };
  }

  forBrowser(cookieHeader: string | undefined, hintedEmail: string | undefined): ResolvedIdentity {
    const sso = this.sso.read(cookieHeader);
    const ssoEmail = sso.ok ? plausibleEmail(sso.email) : null;
    if (ssoEmail) {
      return { userEmail: ssoEmail, claimedEmail: null, identitySource: 'sso_cookie', dropped: false };
    }
    if (hintedEmail === undefined) return anonymous(false);
    const claimed = plausibleEmail(hintedEmail);
    if (!claimed) return anonymous(true);
    return { userEmail: null, claimedEmail: claimed, identitySource: 'client_claimed', dropped: false };
  }
}
