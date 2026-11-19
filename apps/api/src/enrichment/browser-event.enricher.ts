/**
 * Orchestrates the enrichment of validated browser events into WebEventInserts (each step is a
 * separate single-purpose class). Two steps, because the actor and the envelope belong to the REQUEST:
 * - enrichActor (once per batch): IdentityResolver.forBrowser (SSO cookie → sso_cookie, else the
 *   `user.email` hint → client_claimed, else anonymous; a replay skips the cookie) → UserKeyHasher
 *   (verified emails ONLY) → IpAnonymizer.normalize → GeoIpEnricher → IpAnonymizer.anonymize →
 *   UserAgentParser; plus the envelope columns: resolveEnvironment (loopback origin → dev),
 *   client.tz / client.lang (CLIENT_*_PATTERN, else dropped) and `release` (PII-scrubbed).
 * - enrich (per event): PathSanitizer (path, referrerPath) → template plausibility
 *   (isPlausibleRouteTemplate, else dropped) → PiiScrubber pass 1 (path, referrerPath,
 *   routeTemplate, label, props keys/values, tool, name) → RouteNormalizer → PiiScrubber pass 2
 *   (stored path segments) → toWebEventInsert.
 * Soft problems (truncated paths, dropped hint/template/tz/lang/environment, redacted PII) become
 * warnings; the event is still stored.
 */
import {
  CLIENT_LANG_PATTERN,
  CLIENT_TZ_PATTERN,
  ERROR_CODES,
  type BrowserEvent,
  type BrowserIngestEnvelope,
  type IngestWarningCode,
  type PiiField,
  type SsoCookieOutcome,
} from '@nexus/shared';

import { resolveEnvironment } from '../domain/environment';
import type { ActorColumns, WebEventInsert } from '../domain/inserts';
import { isPlausibleRouteTemplate } from '../domain/route-template';
import { toWebEventInsert, type BrowserEnvelopeColumns } from '../domain/to-web-event-insert';
import type { BrowserIngestContext } from '../domain/viewer';
import { sdkLabel, toActorColumns } from './actor-columns';
import type { GeoIpEnricher } from './geo-ip.enricher';
import type { IdentityResolver } from './identity.resolver';
import type { IpAnonymizer } from './ip.anonymizer';
import type { PathSanitizer } from './path.sanitizer';
import { PiiFindings, type EnrichmentWarning, type PiiFinding } from './pii-findings';
import type { PiiScrubber } from './pii.scrubber';
import type { RouteNormalizer } from './route.normalizer';
import type { UserAgentParser } from './user-agent.parser';
import type { UserKeyHasher } from './user-key.hasher';

/** What is the same for every event of one beacon. */
export interface EnrichedBrowserActor {
  actor: ActorColumns;
  envelope: BrowserEnvelopeColumns;
  /** Envelope-level warnings (hint, environment, tz, lang, release) — reported on the first stored event. */
  warnings: EnrichmentWarning[];
  /** PII found in batch-level fields (release) — it is stored on, and counted for, every row. */
  piiFindings: PiiFinding[];
  /** SSO cookie verification outcome; null for replays (the cookie was not read). */
  ssoOutcome: SsoCookieOutcome | null;
}

export interface EnrichedBrowserEvent {
  row: WebEventInsert;
  warnings: EnrichmentWarning[];
  /** PII detections of this event (its own fields + the batch's), one per (field, kind). */
  piiFindings: PiiFinding[];
}

/** Wire field names used in warnings (they name what the SENDER sent). */
const WARNING_FIELDS = {
  path: 'path',
  referrerPath: 'referrerPath',
  routeTemplate: 'routeTemplate',
  userEmail: 'user.email',
  environment: 'environment',
  clientTz: 'client.tz',
  clientLang: 'client.lang',
} as const;

type Props = Record<string, string | number | boolean>;

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
    private readonly pii: PiiScrubber,
  ) {}

  /** Once per batch: who sent it, from where, and the envelope's columns. */
  enrichActor(envelope: BrowserIngestEnvelope, ctx: BrowserIngestContext): EnrichedBrowserActor {
    const identity = this.identity.forBrowser(ctx.request.cookieHeader, envelope.user?.email, {
      replay: ctx.envelope.replay,
    });
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
    const findings = new PiiFindings();
    const columns = this.envelopeColumns(ctx, warnings, findings);
    warnings.push(...findings.warnings());
    return { actor, envelope: columns, warnings, piiFindings: findings.list(), ssoOutcome: identity.ssoOutcome };
  }

  enrich(
    event: BrowserEvent,
    envelope: BrowserIngestEnvelope,
    ctx: BrowserIngestContext,
    batch: EnrichedBrowserActor,
    clockSkewMs: number | null,
  ): EnrichedBrowserEvent {
    const warnings: EnrichmentWarning[] = [];
    const add = (field: string, code: IngestWarningCode) => warnings.push({ field, code });
    const findings = new PiiFindings();

    const sanitized = this.paths.sanitize(event.path);
    const referrer = event.type === 'page_view' && event.referrerPath ? this.paths.sanitize(event.referrerPath) : null;
    const plausible =
      event.routeTemplate === undefined ||
      isPlausibleRouteTemplate(event.routeTemplate, sanitized.path, ctx.app.base_path);
    if (!plausible) add(WARNING_FIELDS.routeTemplate, ERROR_CODES.FIELD_DROPPED);

    const path = this.scrubPathLike(sanitized.path, 'path', findings);
    const referrerPath = referrer ? this.scrubPathLike(referrer.path, 'referrer_path', findings) : null;
    const template =
      plausible && event.routeTemplate ? this.scrubPathLike(event.routeTemplate, 'route_template', findings) : undefined;
    const scrubbed = this.scrubEventText(event, findings);
    const pathTemplate = this.routes.normalize(path, template);

    const storedPath = this.storedSegments(path, 'path', findings);
    const storedReferrer = referrerPath === null ? null : this.storedSegments(referrerPath, 'referrer_path', findings);
    const row = toWebEventInsert(scrubbed, {
      appId: ctx.app.id,
      sessionId: envelope.sessionId,
      anonymousId: envelope.anonymousId ?? null,
      path: storedPath,
      pathTemplate,
      referrerPath: storedReferrer,
      clockSkewMs,
      actor: batch.actor,
      envelope: batch.envelope,
    });
    if (sanitized.truncated) add(WARNING_FIELDS.path, ERROR_CODES.FIELD_TRUNCATED);
    if (referrer?.truncated) add(WARNING_FIELDS.referrerPath, ERROR_CODES.FIELD_TRUNCATED);
    warnings.push(...findings.warnings());
    // The batch's release finding is WARNED once (envelope warning) but COUNTED per stored row.
    return { row, warnings, piiFindings: [...findings.list(), ...batch.piiFindings] };
  }

  // ─── Envelope ────────────────────────────────────────────────────────────

  private envelopeColumns(
    ctx: BrowserIngestContext,
    warnings: EnrichmentWarning[],
    findings: PiiFindings,
  ): BrowserEnvelopeColumns {
    const add = (field: string) => warnings.push({ field, code: ERROR_CODES.FIELD_DROPPED });
    const resolved = resolveEnvironment(ctx.environmentClaim, ctx.request.origin, 'browser');
    if (resolved.droppedClaim) add(WARNING_FIELDS.environment);
    const { tz, lang, release } = ctx.envelope;
    const clientTz = tz !== undefined && CLIENT_TZ_PATTERN.test(tz) ? tz : null;
    if (tz !== undefined && clientTz === null) add(WARNING_FIELDS.clientTz);
    const clientLang = lang !== undefined && CLIENT_LANG_PATTERN.test(lang) ? lang : null;
    if (lang !== undefined && clientLang === null) add(WARNING_FIELDS.clientLang);
    return { environment: resolved.environment, clientTz, clientLang, release: this.droppedIfPii(release, findings) };
  }

  /** release carrying PII is dropped whole (never partially kept). */
  private droppedIfPii(release: string | undefined, findings: PiiFindings): string | null {
    if (release === undefined) return null;
    const { kinds } = this.pii.scrubOpaqueId(release);
    findings.add('release', kinds);
    return kinds.length > 0 ? null : release;
  }

  // ─── Per-event scrubbing ─────────────────────────────────────────────────

  private scrubPathLike(value: string, field: PiiField, findings: PiiFindings): string {
    const result = this.pii.scrubPathLike(value);
    findings.add(field, result.kinds);
    return result.value;
  }

  private storedSegments(value: string, field: 'path' | 'referrer_path', findings: PiiFindings): string {
    const result = this.pii.scrubStoredPathSegments(value);
    findings.add(field, result.kinds);
    return result.value;
  }

  /** label / props / tool / name of the event types that carry them. */
  private scrubEventText(event: BrowserEvent, findings: PiiFindings): BrowserEvent {
    switch (event.type) {
      case 'page_view':
      case 'page_time':
        return event;
      case 'tool_use':
        return {
          ...event,
          tool: this.scrubIdentifier(event.tool, 'tool', findings),
          label: this.scrubLabel(event.label, findings),
          props: this.scrubProps(event.props, findings),
        };
      case 'custom':
        return {
          ...event,
          name: this.scrubIdentifier(event.name, 'name', findings),
          label: this.scrubLabel(event.label, findings),
          props: this.scrubProps(event.props, findings),
        };
    }
  }

  private scrubIdentifier(value: string, field: 'tool' | 'name', findings: PiiFindings): string {
    const result = this.pii.scrubIdentifier(value);
    findings.add(field, result.kinds);
    return result.value;
  }

  private scrubLabel(label: string | undefined, findings: PiiFindings): string | undefined {
    if (label === undefined) return undefined;
    const result = this.pii.scrubText(label);
    findings.add('label', result.kinds);
    return result.value;
  }

  /** A key carrying PII drops the whole prop; string values are scrubbed in place. */
  private scrubProps(props: Props | undefined, findings: PiiFindings): Props | undefined {
    if (props === undefined) return undefined;
    const kept: Props = {};
    for (const [key, value] of Object.entries(props)) {
      const keyKinds = this.pii.scrubText(key).kinds;
      if (keyKinds.length > 0) {
        findings.add('prop_key', keyKinds);
        continue;
      }
      if (typeof value !== 'string') {
        kept[key] = value;
        continue;
      }
      const result = this.pii.scrubText(value);
      findings.add('prop_value', result.kinds);
      kept[key] = result.value;
    }
    return Object.keys(kept).length > 0 ? kept : undefined;
  }
}
