import type { IdentitySource } from '../constants/traffic';
import type { TimelineItemKind } from './users';

/**
 * GET ROUTES.journeys.sessions item (CursorPage, most recent first). A session = one
 * (app, sessionId) of browser events. Identity = the STRONGEST source seen in the session.
 */
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
  /** A browser hint only (identitySource = client_claimed) — show with a "claimed" badge. */
  claimedEmail: string | null;
  identitySource: IdentitySource;
  /** Path templates of the first / last page view. */
  entryPath: string | null;
  exitPath: string | null;
  country: string | null;
  /** First IP of the session. ADMINS ONLY; null for every other viewer. */
  ip: string | null;
}

/**
 * One step of a session replay: browser events ordered by (seq, occurredAt, eventId) with the
 * session's API calls interleaved by time. `page_time` deltas are folded into their page view
 * (`visibleMs`), so `kind` is never `page_time` here.
 */
export interface SessionEventDto {
  eventId: string;
  occurredAt: string;
  seq: number | null;
  kind: TimelineItemKind;
  path: string;
  tool: string | null;
  visibleMs: number | null;
  /** `custom` events only. */
  name: string | null;
  method: string | null;
  status: number | null;
  durationMs: number | null;
}

/** GET ROUTES.journeys.session (404 when the session has no events in the window). */
export interface SessionDetailDto {
  summary: SessionSummaryDto;
  events: SessionEventDto[];
}

/**
 * GET ROUTES.journeys.topPaths item (WindowedListDto) — the most common 3-page sequences
 * (path templates; an immediate reload of the same page is not a step).
 */
export interface TopPathDto {
  app: string;
  steps: string[];
  sessions: number;
}
