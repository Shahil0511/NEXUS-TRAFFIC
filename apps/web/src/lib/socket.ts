/**
 * The dashboard's Socket.io client for the live namespace — the web half of the socket contract
 * (packages/shared/src/events.ts ↔ apps/api/src/socket.ts).
 *
 * WHY: typed with the SHARED event maps, so `socket.on(SOCKET_EVENTS.trafficTick, …)` receives a
 * LiveTickDto and an event name can never be typed by hand. The socket is same-origin: the browser
 * sends the portal `access_token` cookie with the handshake (the api's socket auth), and the path
 * lives under the public base path —
 *   production: /traffic/socket.io → nginx strips /traffic → api /socket.io
 *   `npm run dev`: /traffic/socket.io → next.config.ts dev rewrite → localhost:4000/socket.io
 * Created on the CLIENT only (never during server render) and NOT auto-connected: the hook that
 * owns it connects on mount and closes it on unmount.
 *
 * @see ../features/live/useLiveFeed.ts
 */
import {
  PUBLIC_BASE_PATH,
  SOCKET_NAMESPACES,
  SOCKET_PATH,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@nexus/shared';
import { io, type Socket } from 'socket.io-client';

export type LiveSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Default when NEXT_PUBLIC_SOCKET_PATH is unset (it is inlined at build time). */
export const DEFAULT_SOCKET_PATH = `${PUBLIC_BASE_PATH}${SOCKET_PATH}`;

/** The public Socket.io path. MUST read `process.env.NEXT_PUBLIC_SOCKET_PATH` literally (inlining). */
export function socketPath(): string {
  return process.env.NEXT_PUBLIC_SOCKET_PATH || DEFAULT_SOCKET_PATH;
}

/** A new, not-yet-connected socket to the live namespace of this origin. */
export function createLiveSocket(): LiveSocket {
  return io(`${window.location.origin}${SOCKET_NAMESPACES.live}`, {
    path: socketPath(),
    withCredentials: true,
    autoConnect: false,
  });
}
