/**
 * Collects the PII detections of ONE event (ADR 0010): de-duplicated per (field, kind) across both
 * scrub passes, and turned into FIELD_REDACTED warnings named after the WIRE field the sender used.
 * Used by ServerEventEnricher and BrowserEventEnricher; IngestService sums the findings of the
 * stored events into traffic.pii_detections. Holds kinds and field names only — never a value.
 */
import { ERROR_CODES, type IngestWarningCode, type PiiField, type PiiKind } from '@nexus/shared';

export interface PiiFinding {
  field: PiiField;
  kind: PiiKind;
}

/** A soft problem with one event (the event is still stored). */
export interface EnrichmentWarning {
  field: string;
  code: IngestWarningCode;
}

/** Stored field → the wire field name a warning reports (what the SENDER sent). */
export const PII_WARNING_FIELDS: Readonly<Record<PiiField, string>> = {
  path: 'path',
  route_template: 'routeTemplate',
  referrer_path: 'referrerPath',
  label: 'label',
  prop_key: 'props',
  prop_value: 'props',
  tool: 'tool',
  name: 'name',
  error_code: 'errorCode',
  request_id: 'requestId',
  release: 'release',
};

/** WHY: one detection per (event, field, kind), however many passes or matches found it. */
export class PiiFindings {
  private readonly seen = new Map<string, PiiFinding>();

  add(field: PiiField, kinds: readonly PiiKind[]): void {
    for (const kind of kinds) this.seen.set(`${field}:${kind}`, { field, kind });
  }

  list(): PiiFinding[] {
    return [...this.seen.values()];
  }

  /** One FIELD_REDACTED warning per distinct wire field. */
  warnings(): EnrichmentWarning[] {
    const fields = new Set(this.list().map((finding) => PII_WARNING_FIELDS[finding.field]));
    return [...fields].map((field) => ({ field, code: ERROR_CODES.FIELD_REDACTED }));
  }
}
