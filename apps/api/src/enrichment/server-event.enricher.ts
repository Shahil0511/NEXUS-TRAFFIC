/**
 * Orchestrates the enrichment of ONE validated server event into an ApiRequestInsert
 * (each step is a separate single-purpose class):
 * PathSanitizer → RouteNormalizer → toEndpointId → IpAnonymizer.normalize → GeoIpEnricher →
 * IpAnonymizer.anonymize → UserAgentParser → IdentityResolver.forServer → UserKeyHasher → toApiRequestInsert.
 * Soft problems (truncated path/user agent, dropped ip/email) become warnings; the event is still stored.
 */
import { ERROR_CODES, INGEST_LIMITS, type IngestWarningCode, type ServerEvent } from '@nexus/shared';
import { toEndpointId } from '@nexus/shared/endpoint-id';

import type { ApiRequestInsert } from '../domain/inserts';
import { toApiRequestInsert } from '../domain/to-api-request-insert';
import type { IngestContext } from '../domain/viewer';
import { sdkLabel, toActorColumns } from './actor-columns';
import type { GeoIpEnricher } from './geo-ip.enricher';
import type { ResolvedIdentity, IdentityResolver } from './identity.resolver';
import type { IpAnonymizer } from './ip.anonymizer';
import type { PathSanitizer } from './path.sanitizer';
import type { RouteNormalizer } from './route.normalizer';
import type { UserAgentParser } from './user-agent.parser';
import type { UserKeyHasher } from './user-key.hasher';

export interface EnrichmentWarning {
  field: string;
  code: IngestWarningCode;
}

export interface EnrichedServerEvent {
  row: ApiRequestInsert;
  warnings: EnrichmentWarning[];
}

/** Wire field names used in warnings (they name what the SENDER sent). */
const WARNING_FIELDS = {
  path: 'path',
  ip: 'ip',
  userEmail: 'userEmail',
  userAgent: 'userAgent',
} as const;

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
  ) {}

  enrich(event: ServerEvent, ctx: IngestContext, clockSkewMs: number | null): EnrichedServerEvent {
    const sanitized = this.paths.sanitize(event.path);
    const routeTemplate = this.routes.normalize(sanitized.path, event.routeTemplate);
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
    const row = toApiRequestInsert(event, {
      appId: ctx.app.id,
      endpointId: toEndpointId(ctx.app.slug, event.method, routeTemplate),
      path: sanitized.path,
      routeTemplate,
      clockSkewMs,
      actor,
    });
    const warnings = this.collectWarnings(event, sanitized.truncated, fullIp, identity);
    return { row, warnings };
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
