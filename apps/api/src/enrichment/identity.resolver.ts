/**
 * Decides who an event belongs to and how much we trust it (see IDENTITY_SOURCE_VALUES):
 * - server events: a plausible `userEmail` sent with the SECRET key → app_attested, else anonymous.
 * - browser events: a valid SSO cookie → sso_cookie; else a plausible `user.email` hint →
 *   client_claimed (claimed_email only, user_email stays null); else anonymous.
 * `dropped` = a value was supplied but was not a plausible email (→ FIELD_DROPPED warning).
 */
import type { IdentitySource } from '@nexus/shared';

import type { SsoIdentityReader } from '../auth/sso-identity.reader';
import { notImplemented } from '../lib/not-implemented';

export interface ResolvedIdentity {
  userEmail: string | null;
  claimedEmail: string | null;
  identitySource: IdentitySource;
  dropped: boolean;
}

export class IdentityResolver {
  constructor(private readonly sso: SsoIdentityReader) {}

  forServer(userEmail: string | undefined): ResolvedIdentity {
    void userEmail;
    throw notImplemented('IdentityResolver.forServer');
  }

  forBrowser(cookieHeader: string | undefined, hintedEmail: string | undefined): ResolvedIdentity {
    void cookieHeader;
    void hintedEmail;
    void this.sso;
    throw notImplemented('IdentityResolver.forBrowser');
  }
}
