/**
 * THE ONLY wire→row mapper for browser events: BrowserEvent (wire, a discriminated union on `type`)
 * + its enrichment → WebEventInsert (one flat row; fields of the other event types are null).
 * Used ONLY by BrowserEventEnricher.
 *
 * WHY one place: the wire/column naming differences (type → event_type, final → is_final,
 * reason → time_reason, routeTemplate → path_template, ISO strings → Date, optional → null) live
 * here and nowhere else, so a contract change has exactly one landing spot.
 * @see ../../migrations/0005_web_events.sql
 */
import type { BrowserEvent } from '@nexus/shared';

import type { ActorColumns, WebEventInsert } from './inserts';

/** Everything the server computed about one browser event (paths scrubbed, actor resolved). */
export interface BrowserEventEnrichment {
  appId: string;
  sessionId: string;
  anonymousId: string | null;
  /** Sanitized path (no query/fragment, ≤ maxStoredPathLength). */
  path: string;
  pathTemplate: string;
  /** Sanitized referrerPath (page_view only). */
  referrerPath: string | null;
  clockSkewMs: number | null;
  actor: ActorColumns;
}

/** The per-type columns; every column not set by the event's type stays null. */
type TypeColumns = Pick<
  WebEventInsert,
  | 'referrerHost'
  | 'nav'
  | 'pageViewId'
  | 'visibleMs'
  | 'isFinal'
  | 'timeReason'
  | 'tool'
  | 'action'
  | 'label'
  | 'value'
  | 'name'
  | 'props'
>;

const NO_TYPE_COLUMNS: TypeColumns = {
  referrerHost: null,
  nav: null,
  pageViewId: null,
  visibleMs: null,
  isFinal: null,
  timeReason: null,
  tool: null,
  action: null,
  label: null,
  value: null,
  name: null,
  props: null,
};

function typeColumns(event: BrowserEvent): TypeColumns {
  switch (event.type) {
    case 'page_view':
      return { ...NO_TYPE_COLUMNS, nav: event.nav, referrerHost: event.referrerHost ?? null };
    case 'page_time':
      return {
        ...NO_TYPE_COLUMNS,
        pageViewId: event.pageViewId.toLowerCase(),
        visibleMs: event.visibleMs,
        isFinal: event.final,
        timeReason: event.reason,
      };
    case 'tool_use':
      return {
        ...NO_TYPE_COLUMNS,
        tool: event.tool,
        action: event.action ?? null,
        label: event.label ?? null,
        value: event.value ?? null,
        props: event.props ?? null,
      };
    case 'custom':
      return {
        ...NO_TYPE_COLUMNS,
        name: event.name,
        label: event.label ?? null,
        value: event.value ?? null,
        props: event.props ?? null,
      };
  }
}

/** WHY: maps one validated wire event plus its enrichment to the exact insert shape. */
export function toWebEventInsert(event: BrowserEvent, enrichment: BrowserEventEnrichment): WebEventInsert {
  return {
    ...enrichment.actor,
    ...typeColumns(event),
    occurredAt: new Date(event.occurredAt),
    // Postgres returns uuids lower-cased; normalize so in-batch dedupe and RETURNING ids compare equal.
    eventId: event.eventId.toLowerCase(),
    clockSkewMs: enrichment.clockSkewMs,
    appId: enrichment.appId,
    sessionId: enrichment.sessionId.toLowerCase(),
    anonymousId: enrichment.anonymousId ? enrichment.anonymousId.toLowerCase() : null,
    seq: event.seq,
    eventType: event.type,
    path: enrichment.path,
    pathTemplate: enrichment.pathTemplate,
    referrerPath: enrichment.referrerPath,
  };
}
