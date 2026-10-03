/**
 * Socket.io namespace middleware of SOCKET_NAMESPACES.live — the socket twin of
 * http/middleware/sso-auth.middleware.ts.
 *
 * WHY: a websocket handshake carries the same portal `access_token` cookie as a REST call, so it
 * gets the same two checks: the token (SsoIdentityReader → @nexus/auth) and the env access policy
 * (DashboardAccessPolicy). Refused handshakes get ONE generic message (LIVE_AUTH_ERROR_MESSAGE) —
 * never the reason, never the email. Accepted sockets carry the viewer and the token expiry,
 * which LiveSessionSweeper re-checks every LIVE_SESSION_SWEEP_MS.
 */
import { LIVE_AUTH_ERROR_MESSAGE } from '@nexus/shared';

import type { DashboardAccessPolicy } from '../auth/dashboard-access.policy';
import type { SsoIdentityReader } from '../auth/sso-identity.reader';
import type { LiveSocket } from './live-socket';

const MS_PER_SECOND = 1000;

export type SocketMiddleware = (socket: LiveSocket, next: (err?: Error) => void) => void;

export function socketAuthMiddleware(
  reader: SsoIdentityReader,
  policy: DashboardAccessPolicy,
): SocketMiddleware {
  return (socket, next) => {
    const identity = reader.read(socket.handshake.headers.cookie);
    if (!identity.ok) return next(new Error(LIVE_AUTH_ERROR_MESSAGE));
    const decision = policy.decide(identity.email);
    if (!decision.allowed) return next(new Error(LIVE_AUTH_ERROR_MESSAGE));
    socket.data.viewer = { email: identity.email, isAdmin: decision.isAdmin };
    socket.data.expiresAtMs = identity.expiresAt * MS_PER_SECOND;
    next();
  };
}
