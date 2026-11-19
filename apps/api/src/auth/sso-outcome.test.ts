/**
 * Compile-time parity: SsoCookieOutcome (shared, mirrored by sso_cookie_outcomes_outcome_check) must
 * be EXACTLY `'ok'` + every @nexus/auth cookie failure reason. `no-email` is in both (the verifier
 * reports it, and IdentityResolver maps an ok cookie with an implausible email to it too).
 */
import { SSO_COOKIE_OUTCOME_VALUES, type SsoCookieOutcome } from '@nexus/shared';
import { describe, expect, expectTypeOf, it } from 'vitest';

import type { CookieFailureReason } from './sso-identity.reader';

type Expected = 'ok' | CookieFailureReason;

describe('SsoCookieOutcome ≡ ok | CookieFailureReason', () => {
  it('is equal in both directions (compile time)', () => {
    expectTypeOf<SsoCookieOutcome>().toEqualTypeOf<Expected>();
    const forward: Expected[] = [...SSO_COOKIE_OUTCOME_VALUES];
    const backward = (reason: Expected): SsoCookieOutcome => reason;
    expect(forward.map(backward)).toEqual([...SSO_COOKIE_OUTCOME_VALUES]);
  });
});
