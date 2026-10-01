import type { IdentitySource } from '../constants/traffic';
import type { TimelineItemKind } from './users';

/** GET ROUTES.journeys.sessions item. A session = one (app, sessionId) of browser events. */
export interface SessionSummaryDto {
  app: string;
  sessionId: string;
  startedAt: string;
  lastSeenAt: string;
  durationMs: number;
  pageViews: number;
  toolUses: number;
  visibleMs: number;
  userKey: string | null;
  userEmail: string | null;
  identitySource: IdentitySource;
  entryPath: string | null;
  exitPath: string | null;
  country: string | null;
}

/** One step of a session replay (browser events + correlated API calls). */
export interface SessionEventDto {
  eventId: string;
  occurredAt: string;
  seq: number | null;
  kind: TimelineItemKind;
  path: string;
  tool: string | null;
  visibleMs: number | null;
  method: string | null;
  status: number | null;
  durationMs: number | null;
}

/** GET ROUTES.journeys.session */
export interface SessionDetailDto {
  summary: SessionSummaryDto;
  events: SessionEventDto[];
}

/** GET ROUTES.journeys.topPaths item — the most common 3-page sequences. */
export interface TopPathDto {
  app: string;
  steps: string[];
  sessions: number;
}
