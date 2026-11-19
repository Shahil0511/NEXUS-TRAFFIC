/**
 * Orchestrates the enrichment of ONE validated server event into an ApiRequestInsert
 * (each step is a separate single-purpose class):
 * PathSanitizer → PiiScrubber pass 1 (path, routeTemplate; errorCode as text; requestId, release as
 * opaque ids) →
 * RouteNormalizer → toEndpointId → PiiScrubber pass 2 (stored path segments) →
 * IpAnonymizer.normalize → GeoIpEnricher → IpAnonymizer.anonymize → UserAgentParser →
 * IdentityResolver.forServer → UserKeyHasher → toApiRequestInsert.
 * enrichEnvelope (once per batch): resolveEnvironment (the claim; NO IP heuristic, ADR 0008).
 * Soft problems (truncated path/user agent, dropped ip/email/environment, redacted PII) become
 * warnings; the event is still stored.
 */
import {
  ERROR_CODES,
  INGEST_LIMITS,
  type Environment,
  type IngestWarningCode,
  type PiiField,
  type ServerEvent,
} from '@nexus/shared';
import { toEndpointId } from '@nexus/shared/endpoint-id';

import { resolveEnvironment } from '../domain/environment';
import type { ApiRequestInsert } from '../domain/inserts';
import { toApiRequestInsert } from '../domain/to-api-request-insert';
import type { IngestContext } from '../domain/viewer';
import { sdkLabel, toActorColumns } from './actor-columns';
import type { GeoIpEnricher } from './geo-ip.enricher';
import type { ResolvedIdentity, IdentityResolver } from './identity.resolver';
import type { IpAnonymizer } from './ip.anonymizer';
import type { PathSanitizer } from './path.sanitizer';
import { PiiFindings, type EnrichmentWarning, type PiiFinding } from './pii-findings';
import type { PiiScrubber } from './pii.scrubber';
import type { RouteNormalizer } from './route.normalizer';
import type { UserAgentParser } from './user-agent.parser';
import type { UserKeyHasher } from './user-key.hasher';

export type { EnrichmentWarning, PiiFinding } from './pii-findings';

export interface EnrichedServerEvent {
  row: ApiRequestInsert;
  warnings: EnrichmentWarning[];
  /** PII detections of this event, one per (field, kind). */
  piiFindings: PiiFinding[];
}

/** Batch-level result: the environment of every row plus the envelope warnings. */
export interface EnrichedEnvelope {
  environment: Environment;
  /** Reported once, on the first stored event. */
  warnings: EnrichmentWarning[];
}

/** Wire field names used in warnings (they name what the SENDER sent). */
const WARNING_FIELDS = {
  path: 'path',
  ip: 'ip',
  userEmail: 'userEmail',
  userAgent: 'userAgent',
  environment: 'environment',
} as const;

/**
 * The fields of a server event that are DROPPED (not replaced) on a detection, and how each is
 * scanned: `text` (loose free-text patterns) or `opaque` (strict patterns — random hex / UUID ids
 * hold 10-digit runs that the loose phone rule would flag as a mobile).
 */
type DroppableField = 'errorCode' | 'requestId' | 'release';
type ScanMode = 'text' | 'opaque';
const DROPPABLE_FIELDS: readonly (readonly [DroppableField, PiiField, ScanMode])[] = [
  ['errorCode', 'error_code', 'text'],
  ['requestId', 'request_id', 'opaque'],
  ['release', 'release', 'opaque'],
];

/** WHY: composes the single-purpose enrichers in the one correct order (geo BEFORE anonymizing). */
export class ServerEventEnricher {
  constructor(
    private readonly paths: PathSanitizer,
    private readonly routes: RouteNormalizer,
    private readonly ips: IpAnonymizer,
    private readonly geo: GeoIpEnricher,
    private readonly userAgents: UserAgentParser,
    private readonly identity: IdentityResolver,
    private readonly userKeys: UserKeyHasher,
    private readonly pii: PiiScrubber,
  ) {}

  /** Once per batch: the stored environment (an unknown claim → FIELD_DROPPED `environment`). */
  enrichEnvelope(ctx: IngestContext): EnrichedEnvelope {
    const resolved = resolveEnvironment(ctx.environmentClaim, null, 'server');
    const warnings: EnrichmentWarning[] = resolved.droppedClaim
      ? [{ field: WARNING_FIELDS.environment, code: ERROR_CODES.FIELD_DROPPED }]
      : [];
    return { environment: resolved.environment, warnings };
  }

  enrich(
    event: ServerEvent,
    ctx: IngestContext,
    clockSkewMs: number | null,
    environment: Environment,
  ): EnrichedServerEvent {
    const findings = new PiiFindings();
    const sanitized = this.paths.sanitize(event.path);
    const path = this.scrubPathLike(sanitized.path, 'path', findings);
    const template = event.routeTemplate ? this.scrubPathLike(event.routeTemplate, 'route_template', findings) : undefined;
    const scrubbed = this.dropPiiFields(event, findings);
    const routeTemplate = this.routes.normalize(path, template);
    const storedPath = this.pii.scrubStoredPathSegments(path);
    findings.add('path', storedPath.kinds);
    const fullIp = this.ips.normalize(event.ip);
    const identity = this.identity.forServer(event.userEmail);
    const actor = toActorColumns({
      identity,
      userKey: this.userKeys.hash(identity.userEmail),
      geo: this.geo.lookup(fullIp),
      network: this.ips.anonymize(fullIp),
      userAgent: this.userAgents.parse(event.userAgent),
      sdk: sdkLabel(ctx.sdk),
    });
    const row = toApiRequestInsert(scrubbed, {
      appId: ctx.app.id,
      endpointId: toEndpointId(ctx.app.slug, event.method, routeTemplate),
      path: storedPath.value,
      routeTemplate,
      clockSkewMs,
      actor,
      environment,
    });
    const warnings = [...this.collectWarnings(event, sanitized.truncated, fullIp, identity), ...findings.warnings()];
    return { row, warnings, piiFindings: findings.list() };
  }

  private scrubPathLike(value: string, field: PiiField, findings: PiiFindings): string {
    const result = this.pii.scrubPathLike(value);
    findings.add(field, result.kinds);
    return result.value;
  }

  /** errorCode / requestId / release carrying PII are dropped whole (never partially kept). */
  private dropPiiFields(event: ServerEvent, findings: PiiFindings): ServerEvent {
    const scrubbed: ServerEvent = { ...event };
    for (const [wireField, piiField, mode] of DROPPABLE_FIELDS) {
      const value = event[wireField];
      if (value === undefined) continue;
      const { kinds } = mode === 'opaque' ? this.pii.scrubOpaqueId(value) : this.pii.scrubText(value);
      if (kinds.length === 0) continue;
      findings.add(piiField, kinds);
      scrubbed[wireField] = undefined;
    }
    return scrubbed;
  }

  private collectWarnings(
    event: ServerEvent,
    pathTruncated: boolean,
    fullIp: string | null,
    identity: ResolvedIdentity,
  ): EnrichmentWarning[] {
    const warnings: EnrichmentWarning[] = [];
    const add = (field: string, code: IngestWarningCode) => warnings.push({ field, code });
    if (pathTruncated) add(WARNING_FIELDS.path, ERROR_CODES.FIELD_TRUNCATED);
    if (event.ip !== undefined && fullIp === null) add(WARNING_FIELDS.ip, ERROR_CODES.FIELD_DROPPED);
    if (identity.dropped) add(WARNING_FIELDS.userEmail, ERROR_CODES.FIELD_DROPPED);
    if ((event.userAgent?.length ?? 0) > INGEST_LIMITS.maxUserAgentStoredLength) {
      add(WARNING_FIELDS.userAgent, ERROR_CODES.FIELD_TRUNCATED);
    }
    return warnings;
  }
}
