/**
 * Orchestrates the enrichment of validated browser events into WebEventInserts (each step is a
 * separate single-purpose class). Two steps, because the actor belongs to the REQUEST:
 * - enrichActor (once per batch): IdentityResolver.forBrowser (SSO cookie → sso_cookie, else the
 *   `user.email` hint → client_claimed, else anonymous) → UserKeyHasher (verified emails ONLY) →
 *   IpAnonymizer.normalize → GeoIpEnricher → IpAnonymizer.anonymize → UserAgentParser.
 * - enrich (per event): PathSanitizer (path, referrerPath) → RouteNormalizer → toWebEventInsert.
 * Soft problems (truncated paths, dropped email hint) become warnings; the event is still stored.
 */
import { ERROR_CODES, type BrowserEvent, type BrowserIngestEnvelope, type IngestWarningCode } from '@nexus/shared';

import type { ActorColumns, WebEventInsert } from '../domain/inserts';
import { toWebEventInsert } from '../domain/to-web-event-insert';
import type { BrowserIngestContext } from '../domain/viewer';
import { sdkLabel, toActorColumns } from './actor-columns';
import type { GeoIpEnricher } from './geo-ip.enricher';
import type { IdentityResolver } from './identity.resolver';
import type { IpAnonymizer } from './ip.anonymizer';
import type { PathSanitizer } from './path.sanitizer';
import type { RouteNormalizer } from './route.normalizer';
import type { EnrichmentWarning } from './server-event.enricher';
import type { UserAgentParser } from './user-agent.parser';
import type { UserKeyHasher } from './user-key.hasher';

export interface EnrichedBrowserActor {
  actor: ActorColumns;
  /** Envelope-level warnings (e.g. an implausible `user.email` hint). */
  warnings: EnrichmentWarning[];
}

export interface EnrichedBrowserEvent {
  row: WebEventInsert;
  warnings: EnrichmentWarning[];
}

/** Wire field names used in warnings (they name what the SENDER sent). */
const WARNING_FIELDS = {
  path: 'path',
  referrerPath: 'referrerPath',
  userEmail: 'user.email',
} as const;

/** WHY: composes the single-purpose enrichers in the one correct order (geo BEFORE anonymizing). */
export class BrowserEventEnricher {
  constructor(
    private readonly paths: PathSanitizer,
    private readonly routes: RouteNormalizer,
    private readonly ips: IpAnonymizer,
    private readonly geo: GeoIpEnricher,
    private readonly userAgents: UserAgentParser,
    private readonly identity: IdentityResolver,
    private readonly userKeys: UserKeyHasher,
  ) {}

  /** Once per batch: who sent it and from where (the same for every event of the beacon). */
  enrichActor(envelope: BrowserIngestEnvelope, ctx: BrowserIngestContext): EnrichedBrowserActor {
    const identity = this.identity.forBrowser(ctx.request.cookieHeader, envelope.user?.email);
    const fullIp = this.ips.normalize(ctx.request.ip);
    const actor = toActorColumns({
      identity,
      // user_key ONLY for a verified email (sso_cookie); a client_claimed hint has userEmail null.
      userKey: this.userKeys.hash(identity.userEmail),
      geo: this.geo.lookup(fullIp),
      network: this.ips.anonymize(fullIp),
      userAgent: this.userAgents.parse(ctx.request.userAgent),
      sdk: sdkLabel(ctx.sdk),
    });
    const warnings: EnrichmentWarning[] = identity.dropped
      ? [{ field: WARNING_FIELDS.userEmail, code: ERROR_CODES.FIELD_DROPPED }]
      : [];
    return { actor, warnings };
  }

  enrich(
    event: BrowserEvent,
    envelope: BrowserIngestEnvelope,
    ctx: BrowserIngestContext,
    actor: ActorColumns,
    clockSkewMs: number | null,
  ): EnrichedBrowserEvent {
    const sanitized = this.paths.sanitize(event.path);
    const referrer = event.type === 'page_view' && event.referrerPath ? this.paths.sanitize(event.referrerPath) : null;
    const row = toWebEventInsert(event, {
      appId: ctx.app.id,
      sessionId: envelope.sessionId,
      anonymousId: envelope.anonymousId ?? null,
      path: sanitized.path,
      pathTemplate: this.routes.normalize(sanitized.path, event.routeTemplate),
      referrerPath: referrer?.path ?? null,
      clockSkewMs,
      actor,
    });
    const warnings: EnrichmentWarning[] = [];
    const add = (field: string, code: IngestWarningCode) => warnings.push({ field, code });
    if (sanitized.truncated) add(WARNING_FIELDS.path, ERROR_CODES.FIELD_TRUNCATED);
    if (referrer?.truncated) add(WARNING_FIELDS.referrerPath, ERROR_CODES.FIELD_TRUNCATED);
    return { row, warnings };
  }
}
