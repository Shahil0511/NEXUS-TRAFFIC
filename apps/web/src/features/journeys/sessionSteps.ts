/**
 * Pure helpers of the session replay.
 *
 * WHY: the replay reads "page → time spent → tools → API calls". The API sends one ordered list;
 * grouping it under the page view each event happened on is presentation, so it lives here
 * (pure, unit-tested) instead of inside the component.
 */
import type { ActorDto, SessionEventDto, SessionSummaryDto } from '@nexus/shared';

export interface SessionStep {
  /** The page view that opens the step; null for events before the first page view. */
  page: SessionEventDto | null;
  /** Tool uses, API calls and custom events that followed it, in order. */
  events: SessionEventDto[];
}

/** Group an ordered event list under its page views. */
export function groupSessionSteps(events: readonly SessionEventDto[]): SessionStep[] {
  const steps: SessionStep[] = [];
  for (const event of events) {
    if (event.kind === 'page_view') {
      steps.push({ page: event, events: [] });
      continue;
    }
    const current = steps.at(-1);
    if (current) current.events.push(event);
    else steps.push({ page: null, events: [event] });
  }
  return steps;
}

/** The session's identity in the shape ActorCell renders (country only: no city on a session). */
export function sessionActor(session: SessionSummaryDto): ActorDto {
  return {
    userKey: session.userKey,
    userEmail: session.userEmail,
    claimedEmail: session.claimedEmail,
    identitySource: session.identitySource,
    ip: session.ip,
    geo: session.country ? { country: session.country, region: null, city: null } : null,
  };
}
