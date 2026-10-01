/**
 * Reads the signed-in portal user from a raw Cookie header.
 * Thin injectable wrapper over @nexus/auth (adds the injectable Clock and a debug counter for
 * tokens without a `type` claim, which we accept but want to see).
 */
import { verifyAccessTokenCookie, type CookieVerifyResult } from '@nexus/auth';

import type { Clock } from '../lib/clock';
import type { Logger } from '../lib/logger';

export type SsoIdentity = { ok: true; email: string; expiresAt: number } | { ok: false; reason: string };

export class SsoIdentityReader {
  constructor(
    private readonly secret: string,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  read(cookieHeader: string | undefined): SsoIdentity {
    const result: CookieVerifyResult = verifyAccessTokenCookie(cookieHeader, this.secret, this.clock.now().getTime());
    if (!result.ok) return { ok: false, reason: result.reason };
    if (result.typeMissing) this.logger.debug('access_token without type claim accepted');
    return { ok: true, email: result.email, expiresAt: result.expiresAt };
  }
}
