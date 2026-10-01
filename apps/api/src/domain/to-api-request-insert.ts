/**
 * THE ONLY wire→row mapper for server events: ServerEvent (wire, camelCase, `status`) + its
 * enrichment → ApiRequestInsert (row, `statusCode`). Used ONLY by ServerEventEnricher.
 *
 * WHY one place: the wire/column naming differences (status → status_code, ISO strings → Date,
 * optional → null) live here and nowhere else, so a contract change has exactly one landing spot.
 * @see ../../migrations/0004_api_requests.sql
 */
import type { ServerEvent } from '@nexus/shared';

import type { ActorColumns, ApiRequestInsert } from './inserts';

/** Everything the server computed about one event (paths scrubbed, ids derived, actor resolved). */
export interface ServerEventEnrichment {
  appId: string;
  endpointId: string;
  /** Sanitized path (no query/fragment, ≤ maxStoredPathLength). */
  path: string;
  routeTemplate: string;
  clockSkewMs: number | null;
  actor: ActorColumns;
}

/** Postgres returns uuids lower-cased; normalize so in-batch dedupe and RETURNING ids compare equal. */
function uuidOrNull(value: string | undefined): string | null {
  return value ? value.toLowerCase() : null;
}

/** WHY: maps one validated wire event plus its enrichment to the exact insert shape. */
export function toApiRequestInsert(event: ServerEvent, enrichment: ServerEventEnrichment): ApiRequestInsert {
  return {
    ...enrichment.actor,
    occurredAt: new Date(event.occurredAt),
    eventId: event.eventId.toLowerCase(),
    clockSkewMs: enrichment.clockSkewMs,
    appId: enrichment.appId,
    endpointId: enrichment.endpointId,
    kind: event.kind,
    method: event.method,
    routeTemplate: enrichment.routeTemplate,
    path: enrichment.path,
    statusCode: event.status,
    durationMs: event.durationMs,
    requestBytes: event.requestBytes ?? null,
    responseBytes: event.responseBytes ?? null,
    errorCode: event.errorCode ?? null,
    release: event.release ?? null,
    requestId: event.requestId ?? null,
    sessionId: uuidOrNull(event.sessionId),
    pageViewId: uuidOrNull(event.pageViewId),
  };
}
