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
