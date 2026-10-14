import type { HttpMethod, ServerEventKind } from '../constants/traffic';
import type { ActorDto } from './common';

/** One stored backend request, as shown in lists (failures, slowest calls, timelines). */
export interface RequestSampleDto {
  eventId: string;
  occurredAt: string;
  app: string;
  kind: ServerEventKind;
  method: HttpMethod;
  path: string;
  routeTemplate: string;
  endpointId: string;
  status: number;
  durationMs: number;
  errorCode: string | null;
  requestId: string | null;
  /** The browser session that made the call (tracker header); null for server-to-server calls. */
  sessionId: string | null;
  actor: ActorDto;
}

/** GET ROUTES.errors.list item. */
export type FailedRequestDto = RequestSampleDto;
