/**
 * Orchestrates the enrichment of ONE validated server event into an ApiRequestInsert
 * (each step is a separate single-purpose class):
 * PathSanitizer → RouteNormalizer → toEndpointId → IpAnonymizer.normalize → GeoIpEnricher →
 * IpAnonymizer.anonymize → UserAgentParser → IdentityResolver.forServer → UserKeyHasher → toApiRequestInsert.
 * Soft problems (truncated path, dropped ip/email) become warnings; the event is still stored.
 */
import type { IngestWarningCode, ServerEvent } from '@nexus/shared';

import type { ApiRequestInsert } from '../domain/inserts';
import type { IngestContext } from '../domain/viewer';
import { notImplemented } from '../lib/not-implemented';
import type { GeoIpEnricher } from './geo-ip.enricher';
import type { IdentityResolver } from './identity.resolver';
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
    void event;
    void ctx;
    void clockSkewMs;
    void this.paths;
    void this.routes;
    void this.ips;
    void this.geo;
    void this.userAgents;
    void this.identity;
    void this.userKeys;
    throw notImplemented('ServerEventEnricher.enrich');
  }
}
