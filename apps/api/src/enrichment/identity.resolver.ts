/**
 * Decides who an event belongs to and how much we trust it (see IDENTITY_SOURCE_VALUES):
 * - server events: a plausible `userEmail` sent with the SECRET key → app_attested, else anonymous.
 * - browser events: a valid SSO cookie → sso_cookie; else a plausible `user.email` hint →
 *   client_claimed (claimed_email only, user_email stays null); else anonymous.
 *   A REPLAY (client.replay, ADR 0012) never reads the cookie: the batch was captured on an earlier
 *   load, and the cookie riding on this request may belong to someone else by now.
 * `dropped` = a value was supplied but was not a plausible email (→ FIELD_DROPPED warning).
 * `ssoOutcome` = how the cookie verification went (traffic.sso_cookie_outcomes); null when the
 * cookie was not read (server events, replays).
 */
import { plausibleEmail } from '@nexus/auth';
import type { IdentitySource, SsoCookieOutcome } from '@nexus/shared';

import type { SsoIdentityReader } from '../auth/sso-identity.reader';

export interface ResolvedIdentity {
  userEmail: string | null;
  claimedEmail: string | null;
  identitySource: IdentitySource;
  dropped: boolean;
  ssoOutcome: SsoCookieOutcome | null;
}

export interface BrowserIdentityOptions {
  /** A cross-load retry-queue replay: skip the SSO cookie entirely. */
  replay: boolean;
}

/** An ok cookie whose email is not plausible. */
const IMPLAUSIBLE_EMAIL_OUTCOME: SsoCookieOutcome = 'no-email';
const OK_OUTCOME: SsoCookieOutcome = 'ok';

function anonymous(dropped: boolean, ssoOutcome: SsoCookieOutcome | null): ResolvedIdentity {
  return { userEmail: null, claimedEmail: null, identitySource: 'anonymous', dropped, ssoOutcome };
}

interface CookieIdentity {
  email: string | null;
  outcome: SsoCookieOutcome | null;
}

/** WHY: ONLY verified sources may fill user_email — forged browser hints must never count. */
export class IdentityResolver {
  constructor(private readonly sso: SsoIdentityReader) {}

  forServer(userEmail: string | undefined): ResolvedIdentity {
    if (userEmail === undefined) return anonymous(false, null);
    const email = plausibleEmail(userEmail);
    if (!email) return anonymous(true, null);
    return { userEmail: email, claimedEmail: null, identitySource: 'app_attested', dropped: false, ssoOutcome: null };
  }

  forBrowser(
    cookieHeader: string | undefined,
    hintedEmail: string | undefined,
    options: BrowserIdentityOptions,
  ): ResolvedIdentity {
    const cookie = options.replay ? { email: null, outcome: null } : this.readCookie(cookieHeader);
    if (cookie.email) {
      return {
        userEmail: cookie.email,
        claimedEmail: null,
        identitySource: 'sso_cookie',
        dropped: false,
        ssoOutcome: cookie.outcome,
      };
    }
    if (hintedEmail === undefined) return anonymous(false, cookie.outcome);
    const claimed = plausibleEmail(hintedEmail);
    if (!claimed) return anonymous(true, cookie.outcome);
    return {
      userEmail: null,
      claimedEmail: claimed,
      identitySource: 'client_claimed',
      dropped: false,
      ssoOutcome: cookie.outcome,
    };
  }

  private readCookie(cookieHeader: string | undefined): CookieIdentity {
    const sso = this.sso.read(cookieHeader);
    if (!sso.ok) return { email: null, outcome: sso.reason };
    const email = plausibleEmail(sso.email);
    return email ? { email, outcome: OK_OUTCOME } : { email: null, outcome: IMPLAUSIBLE_EMAIL_OUTCOME };
  }
}
