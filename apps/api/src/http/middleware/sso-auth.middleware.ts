/**
 * Dashboard authentication + authorization (the REAL gate; the web proxy is only a UX gate).
 * 1. Verify the portal `access_token` cookie (SsoIdentityReader → @nexus/auth).
 * 2. Apply the env access policy (DashboardAccessPolicy → @nexus/auth decideDashboardAccess).
 * Sets res.locals.viewer.
 */
import type { RequestHandler } from 'express';

import type { DashboardAccessPolicy } from '../../auth/dashboard-access.policy';
import type { SsoIdentityReader } from '../../auth/sso-identity.reader';
import { ForbiddenError, UnauthorizedError } from '../../errors/app-error';

export function ssoAuthMiddleware(reader: SsoIdentityReader, policy: DashboardAccessPolicy): RequestHandler {
  return (req, res, next) => {
    const identity = reader.read(req.headers.cookie);
    if (!identity.ok) throw new UnauthorizedError('Sign in through the portal to use the dashboard');
    const decision = policy.decide(identity.email);
    if (!decision.allowed) throw new ForbiddenError('Your account is not allowed to view Data Nexus Traffic');
    res.locals.viewer = { email: identity.email, isAdmin: decision.isAdmin };
    next();
  };
}
