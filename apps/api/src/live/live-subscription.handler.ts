/**
 * `live:subscribe` / `live:unsubscribe` of an authenticated live socket.
 *
 * WHY: a subscription is just Socket.io room membership — `liveRoom(filter, role)` — so the
 * broadcaster can address "everyone watching app X who may see IPs" with one emit. The role comes
 * from the socket (set by socket-auth.middleware), NEVER from the client. A socket watches ONE
 * scope at a time: subscribing again moves it.
 *
 * Client input is untrusted: the filter is validated with the SHARED liveFilterSchema and the app
 * must exist (same resolver as REST filters); the ack is called only if it is a function.
 */
import {
  liveFilterSchema,
  liveRoom,
  liveScopeKey,
  parseLiveRoom,
  SOCKET_EVENTS,
  type LiveFilter,
  type LiveSubscribeAck,
} from '@nexus/shared';

import { NotFoundError } from '../errors/app-error';
import type { Logger } from '../lib/logger';
import type { AppSlugResolver } from '../services/app-slug.resolver';
import { liveRoleOf, type LiveSocket } from './live-socket';

export const SUBSCRIBE_ERRORS = {
  invalidFilter: 'invalid filter',
  unknownApp: 'unknown app',
  unavailable: 'temporarily unavailable',
} as const;

function reply(ack: unknown, result: LiveSubscribeAck): LiveSubscribeAck {
  if (typeof ack === 'function') (ack as (r: LiveSubscribeAck) => void)(result);
  return result;
}

export class LiveSubscriptionHandler {
  constructor(
    private readonly appSlugs: AppSlugResolver,
    private readonly logger: Logger,
  ) {}

  /** `connection` listener of the live namespace. */
  register = (socket: LiveSocket): void => {
    socket.on(SOCKET_EVENTS.subscribe, (filter, ack) => void this.subscribe(socket, filter, ack));
    socket.on(
      SOCKET_EVENTS.unsubscribe,
      (filter, ack) => void this.unsubscribe(socket, filter, ack),
    );
  };

  /** Validates the filter, checks the app, then moves the socket into the scope's role room. */
  async subscribe(
    socket: LiveSocket,
    rawFilter: unknown,
    ack?: unknown,
  ): Promise<LiveSubscribeAck> {
    const parsed = liveFilterSchema.safeParse(rawFilter ?? {});
    if (!parsed.success)
      return reply(ack, { ok: false, scope: '', error: SUBSCRIBE_ERRORS.invalidFilter });
    const filter: LiveFilter = parsed.data.app ? { app: parsed.data.app } : {};
    const scope = liveScopeKey(filter);
    const problem = await this.appProblem(filter);
    if (problem) return reply(ack, { ok: false, scope, error: problem });

    await this.leaveLiveRooms(socket);
    await socket.join(liveRoom(filter, liveRoleOf(socket.data.viewer)));
    return reply(ack, { ok: true, scope });
  }

  /** Leaves the scope's room (no-op when the socket was not in it). */
  async unsubscribe(
    socket: LiveSocket,
    rawFilter: unknown,
    ack?: unknown,
  ): Promise<LiveSubscribeAck> {
    const parsed = liveFilterSchema.safeParse(rawFilter ?? {});
    if (!parsed.success)
      return reply(ack, { ok: false, scope: '', error: SUBSCRIBE_ERRORS.invalidFilter });
    const filter: LiveFilter = parsed.data.app ? { app: parsed.data.app } : {};
    await socket.leave(liveRoom(filter, liveRoleOf(socket.data.viewer)));
    return reply(ack, { ok: true, scope: liveScopeKey(filter) });
  }

  /** null when the filter's app exists (or no app is given), else the ack error. */
  private async appProblem(filter: LiveFilter): Promise<string | null> {
    try {
      await this.appSlugs.resolve(filter.app);
      return null;
    } catch (err) {
      if (err instanceof NotFoundError) return SUBSCRIBE_ERRORS.unknownApp;
      this.logger.warn('live subscribe failed', { err });
      return SUBSCRIBE_ERRORS.unavailable;
    }
  }

  private async leaveLiveRooms(socket: LiveSocket): Promise<void> {
    for (const room of [...socket.rooms]) {
      if (parseLiveRoom(room)) await socket.leave(room);
    }
  }
}
