/**
 * Assembles the identity + network + client columns shared by BOTH event tables (ActorColumns)
 * from the outputs of the single-purpose enrichers. Used by ServerEventEnricher and
 * BrowserEventEnricher, so api_requests and web_events always fill these columns identically.
 */
import { INGEST_LIMITS } from '@nexus/shared';

import type { ActorColumns } from '../domain/inserts';
import type { GeoInfo } from './geo-ip.enricher';
import type { ResolvedIdentity } from './identity.resolver';
import type { AnonymizedIp } from './ip.anonymizer';
import type { ParsedUserAgent } from './user-agent.parser';

export interface ActorParts {
  identity: ResolvedIdentity;
  userKey: Buffer | null;
  network: AnonymizedIp;
  geo: GeoInfo | null;
  userAgent: ParsedUserAgent;
  sdk: string | null;
}

/** WHY: one mapping from enricher outputs to columns — both ingest paths must agree on it. */
export function toActorColumns(parts: ActorParts): ActorColumns {
  const { identity, network, geo, userAgent } = parts;
  return {
    userEmail: identity.userEmail,
    userKey: parts.userKey,
    claimedEmail: identity.claimedEmail,
    identitySource: identity.identitySource,
    ip: network.ip,
    ipHash: network.ipHash,
    ipClass: network.ipClass,
    geoCountry: geo?.country ?? null,
    geoRegion: geo?.region ?? null,
    geoCity: geo?.city ?? null,
    geoLat: geo?.lat ?? null,
    geoLon: geo?.lon ?? null,
    uaBrowser: userAgent.browser,
    uaOs: userAgent.os,
    uaDevice: userAgent.device,
    sdk: parts.sdk,
  };
}

/** The stored `sdk` label, cut to the column limit (null when the sender named none). */
export function sdkLabel(sdk: string | null): string | null {
  return sdk ? sdk.slice(0, INGEST_LIMITS.maxSdkNameLength) : null;
}
