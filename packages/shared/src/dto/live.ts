/**
 * Real-time payloads (Socket.io namespace SOCKET_NAMESPACES.live) and the REST snapshot.
 * A tick carries CUMULATIVE counts for the current minute; the client upserts by `minute`.
 */
import type { TimelineItemKind } from './users';

export interface LiveTickDto {
  /** liveScopeKey() of the subscription, e.g. "all" or "app:ebo-sales". */
  scope: string;
  /** ISO start of the minute bucket these counts belong to. */
  minute: string;
  requests: number;
  errors4xx: number;
  errors5xx: number;
  p95Ms: number | null;
  pageViews: number;
  toolUses: number;
  /** Distinct users/sessions seen in the last 5 minutes. */
  activeUsers: number;
}

export interface LiveEventDto {
  eventId: string;
  occurredAt: string;
  app: string;
  kind: TimelineItemKind;
  path: string;
  method: string | null;
  status: number | null;
  durationMs: number | null;
  tool: string | null;
  userEmail: string | null;
  /** Opaque user id (verified identities only) → the user's page. */
  userKey: string | null;
  /** `api` events only: the stored route → the route's page. */
  endpointId: string | null;
  /** Browser session (replay link when the event is a browser event). */
  sessionId: string | null;
  /** null for non-admin viewers. */
  ip: string | null;
  country: string | null;
  city: string | null;
}

/** GET ROUTES.live.snapshot — the last 60 minutes + recent events, built from the DB. */
export interface LiveSnapshotDto {
  ticks: LiveTickDto[];
  recent: LiveEventDto[];
}

export interface LiveSubscribeAck {
  ok: boolean;
  scope: string;
  error?: string;
}

/**
 * One verified person active in ONE app within the last ACTIVE_USER_WINDOW_MS (a person in two
 * apps is two rows). `lastEvent` is what they did last; `currentPage` the template of their newest
 * page view (null for API-only activity). Paths are templates, never raw ingested paths.
 */
export interface OnlineUserDto {
  userKey: string;
  email: string;
  app: string;
  /** Browser session of the newest event; null for server-only calls. */
  sessionId: string | null;
  currentPage: string | null;
  lastEvent: {
    kind: TimelineItemKind;
    /** Page template (browser events) or route template (API calls). */
    path: string;
    tool: string | null;
    method: string | null;
    status: number | null;
    /** `api` events only: the stored route. */
    endpointId: string | null;
  };
  lastSeenAt: string;
  /** Events of this person in this app inside the window. */
  events: number;
}

/** Active people per app right now: verified users + anonymous browser sessions. */
export interface OnlineAppDto {
  app: string;
  users: number;
  anonymous: number;
}

/** GET ROUTES.live.online — who is active right now, per app and per person (newest first). */
export interface OnlineNowDto {
  /** Server time of the snapshot (ISO). */
  asOf: string;
  windowMs: number;
  /** Apps with at least one active person, busiest first. */
  apps: OnlineAppDto[];
  /** Verified people, most recently active first (capped by the API). */
  users: OnlineUserDto[];
}
