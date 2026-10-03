/**
 * createRealtime: attaches Socket.io to the HTTP server (called by server.ts AFTER listen).
 *
 * Wiring, in order:
 *   new Server({ path: SOCKET_PATH, allowRequest: origin policy })
 *   → the default namespace refuses everyone (nothing lives there)
 *   → io.of(SOCKET_NAMESPACES.live).use(socketAuth)          SSO cookie + access policy
 *   → on connection: LiveSubscriptionHandler.register        live:subscribe / live:unsubscribe
 *   → LiveTickScheduler.start()                               traffic:tick, traffic:events, sweep
 *
 * Every piece is built by the container (`c.realtime`); this file only connects them to the server.
 * nginx maps https://nexus.libas.in/traffic/socket.io/ → here (/traffic stripped).
 *
 * @see ./live/socket-origin.policy.ts
 * @see ./live/socket-auth.middleware.ts
 * @see ./live/live-subscription.handler.ts
 * @see ./live/live-tick.scheduler.ts
 */
import type { Server as HttpServer } from 'node:http';

import { LIVE_AUTH_ERROR_MESSAGE, SOCKET_NAMESPACES, SOCKET_PATH } from '@nexus/shared';
import { Server } from 'socket.io';

import type { Container } from './container';
import type { LiveNamespace, LiveServer } from './live/live-socket';
import { LiveTickScheduler } from './live/live-tick.scheduler';
import { allowedSocketOrigins, createAllowRequest } from './live/socket-origin.policy';

export interface Realtime {
  io: LiveServer;
  live: LiveNamespace;
  /** Stops the timers, disconnects every socket and closes the engine (shutdown). */
  close: () => Promise<void>;
}

export function createRealtime(httpServer: HttpServer, c: Container): Realtime {
  const io: LiveServer = new Server(httpServer, {
    path: SOCKET_PATH,
    serveClient: false,
    allowRequest: createAllowRequest(allowedSocketOrigins(c.config)),
  });
  io.of('/').use((_socket, next) => next(new Error(LIVE_AUTH_ERROR_MESSAGE)));

  const live: LiveNamespace = io.of(SOCKET_NAMESPACES.live);
  live.use(c.realtime.socketAuth);
  live.on('connection', c.realtime.subscriptions.register);

  const scheduler = new LiveTickScheduler(
    live,
    c.realtime.broadcaster,
    c.realtime.sweeper,
    c.clock,
    c.logger,
  );
  scheduler.start();

  return {
    io,
    live,
    close: async () => {
      scheduler.stop();
      io.disconnectSockets(true);
      // io.close() also closes the HTTP server; shutdown's own server.close() then no-ops.
      await new Promise<void>((resolve) => void io.close(() => resolve()));
    },
  };
}
