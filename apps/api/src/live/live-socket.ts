/**
 * Types of the live Socket.io namespace (SOCKET_NAMESPACES.live), typed with the SHARED event maps
 * so an emit with a wrong event name or payload does not compile.
 *
 * WHY A MODULE: socket.ts, the auth middleware, the subscription handler, the broadcaster and the
 * sweeper all speak about the same sockets; one definition keeps their `socket.data` in sync.
 */
import type { ClientToServerEvents, LiveRole, ServerToClientEvents } from '@nexus/shared';
import type { Namespace, Server, Socket } from 'socket.io';

import type { Viewer } from '../domain/viewer';

/** What socket-auth.middleware stores on every accepted socket. */
export interface LiveSocketData {
  viewer: Viewer;
  /** Expiry of the SSO access_token the socket was opened with (epoch ms). */
  expiresAtMs: number;
}

/** No server-to-server events (single instance; ADR 0001 — Redis adapter is v1.1). */
type NoInterServerEvents = Record<string, never>;

export type LiveServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  NoInterServerEvents,
  LiveSocketData
>;
export type LiveNamespace = Namespace<
  ClientToServerEvents,
  ServerToClientEvents,
  NoInterServerEvents,
  LiveSocketData
>;
export type LiveSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  NoInterServerEvents,
  LiveSocketData
>;

/** WHY: the room a socket joins depends on whether it may see IPs (ADR 0001 "IP / PII"). */
export function liveRoleOf(viewer: Viewer): LiveRole {
  return viewer.isAdmin ? 'admin' : 'viewer';
}
