/**
 * Real-time (Socket.io) contract between apps/api/src/socket.ts and apps/web/src/lib/socket.ts.
 *
 * WHY: event names are the socket equivalent of ROUTES — both sides import these constants, so
 * "Find All References" on SOCKET_EVENTS.trafficTick shows the emitter and the listener. The typed
 * event maps use COMPUTED keys, so the types follow the constants. NEVER write 'traffic:tick' as a
 * literal anywhere else.
 *
 * ZERO runtime dependencies.
 */
import type { LiveEventDto, LiveSubscribeAck, LiveTickDto } from './dto/live';

export const SOCKET_NAMESPACES = {
  live: '/live',
} as const;

/**
 * Socket.io server path (apps/api/src/socket.ts). Browsers reach it under the public base path
 * (`/traffic/socket.io`, nginx strips `/traffic`); the web client reads NEXT_PUBLIC_SOCKET_PATH.
 */
export const SOCKET_PATH = '/socket.io';

export const SOCKET_EVENTS = {
  /** client → server: join a live scope. */
  subscribe: 'live:subscribe',
  /** client → server: leave a live scope. */
  unsubscribe: 'live:unsubscribe',
  /** server → client: cumulative current-minute counters, every LIVE_TICK_MS. */
  trafficTick: 'traffic:tick',
  /** server → client: batch of the newest committed events (role-masked). */
  trafficEvents: 'traffic:events',
  /** server → client: the SSO token expired or access was revoked; client should re-login. */
  sessionExpired: 'live:session-expired',
} as const;

export const LIVE_TICK_MS = 2000;
export const LIVE_EVENTS_FLUSH_MS = 1000;
export const LIVE_EVENTS_MAX_BATCH = 100;
export const LIVE_SNAPSHOT_MINUTES = 60;
export const LIVE_SNAPSHOT_RECENT_EVENTS = 50;
/** Window used for "active users now". */
export const ACTIVE_USER_WINDOW_MS = 5 * 60 * 1000;
/** How often the api re-checks every connected socket's SSO token expiry and access policy. */
export const LIVE_SESSION_SWEEP_MS = 60 * 1000;

/** Why the server ended a live session (payload of SOCKET_EVENTS.sessionExpired). */
export const LIVE_SESSION_END_REASON_VALUES = ['expired', 'revoked'] as const;
export type LiveSessionEndReason = (typeof LIVE_SESSION_END_REASON_VALUES)[number];

/**
 * `connect_error` message of a refused handshake (bad/missing SSO cookie or not on the policy).
 * The client treats it like SOCKET_EVENTS.sessionExpired: back to the portal login.
 */
export const LIVE_AUTH_ERROR_MESSAGE = 'unauthorized';

/** What a dashboard client subscribes to. No app = all apps. */
export interface LiveFilter {
  app?: string;
}

export const LIVE_ROLE_VALUES = ['admin', 'viewer'] as const;
export type LiveRole = (typeof LIVE_ROLE_VALUES)[number];

/** Stable key of a subscription scope — also echoed in LiveTickDto.scope. */
export function liveScopeKey(filter: LiveFilter): string {
  return filter.app ? `app:${filter.app}` : 'all';
}

/** Socket.io room of a scope key (liveScopeKey) + role (viewer payloads carry no IP). */
export function liveRoomOfScope(scope: string, role: LiveRole): string {
  return `${scope}:${role}`;
}

/** Socket.io room for a scope + role (viewer payloads carry no IP). */
export function liveRoom(filter: LiveFilter, role: LiveRole): string {
  return liveRoomOfScope(liveScopeKey(filter), role);
}

/** Inverse of liveRoomOfScope; null for any other room (e.g. a socket's own id room). */
export function parseLiveRoom(room: string): { scope: string; role: LiveRole } | null {
  for (const role of LIVE_ROLE_VALUES) {
    const suffix = `:${role}`;
    if (room.length > suffix.length && room.endsWith(suffix)) {
      return { scope: room.slice(0, -suffix.length), role };
    }
  }
  return null;
}

export interface ServerToClientEvents {
  [SOCKET_EVENTS.trafficTick]: (tick: LiveTickDto) => void;
  [SOCKET_EVENTS.trafficEvents]: (events: LiveEventDto[]) => void;
  [SOCKET_EVENTS.sessionExpired]: (payload: { reason: LiveSessionEndReason }) => void;
}

export interface ClientToServerEvents {
  [SOCKET_EVENTS.subscribe]: (filter: LiveFilter, ack: (result: LiveSubscribeAck) => void) => void;
  [SOCKET_EVENTS.unsubscribe]: (
    filter: LiveFilter,
    ack?: (result: LiveSubscribeAck) => void,
  ) => void;
}
