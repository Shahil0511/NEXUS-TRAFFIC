/**
 * Ends live sockets whose SSO session is over.
 *
 * WHY: a REST call re-checks the cookie on every request, but a websocket is authenticated ONCE at
 * the handshake and can stay open for hours. Every LIVE_SESSION_SWEEP_MS each socket is checked
 * again: an expired token, an email no longer on the access policy, or an admin flag that changed
 * (the socket sits in the wrong role room) → emit `live:session-expired` then disconnect. The
 * client sends the user back to the portal login.
 */
import { SOCKET_EVENTS, type LiveSessionEndReason } from '@nexus/shared';

import type { DashboardAccessPolicy } from '../auth/dashboard-access.policy';
import type { LiveNamespace, LiveSocketData } from './live-socket';

export class LiveSessionSweeper {
  constructor(private readonly policy: DashboardAccessPolicy) {}

  /** Why this socket must end now, or null while it is still valid. */
  endReasonOf(data: Partial<LiveSocketData>, nowMs: number): LiveSessionEndReason | null {
    if (!data.viewer || data.expiresAtMs === undefined) return 'revoked';
    if (data.expiresAtMs <= nowMs) return 'expired';
    const decision = this.policy.decide(data.viewer.email);
    if (!decision.allowed || decision.isAdmin !== data.viewer.isAdmin) return 'revoked';
    return null;
  }

  /** Checks every socket of the namespace; returns how many were ended. */
  sweep(namespace: Pick<LiveNamespace, 'sockets'>, now: Date): number {
    let ended = 0;
    for (const socket of namespace.sockets.values()) {
      const reason = this.endReasonOf(socket.data, now.getTime());
      if (!reason) continue;
      socket.emit(SOCKET_EVENTS.sessionExpired, { reason });
      socket.disconnect(true);
      ended += 1;
    }
    return ended;
  }
}
