/**
 * What the Integration page SAYS about a status or a warning, and which guide chapter fixes it.
 *
 * WHY one table: the API decides (apps/api/src/domain/integration-health.ts, thresholds in
 * @nexus/shared constants/integration.ts); this file only explains. A `Record` over the shared
 * value lists makes a new code a compile error until it has copy.
 */
import {
  CLOCK_SKEW_WARN_MS,
  COVERAGE_TARGET_RATIO,
  INTEGRATION_STALE_AFTER_MS,
  PRIVATE_IP_RATIO_THRESHOLD,
  RELEASE_COVERAGE_TARGET,
  type BeaconOrigin,
  type IngestSource,
  type IngestRejectionCode,
  type IntegrationLevel,
  type IntegrationStatus,
  type IntegrationWarning,
  type PiiField,
  type PiiKind,
  type SsoCookieOutcome,
} from '@nexus/shared';

import { EMPTY_VALUE } from '@/lib/format';
import type { GuideChapter } from '@/lib/guide';
import { navLabel } from '@/lib/nav';

export type Tone = 'success' | 'warning' | 'destructive' | 'muted';

const MS_PER_SECOND = 1000;
const MS_PER_HOUR = 3_600_000;

/** One name per ingest source, shared by every block of the Integration page. */
export const SOURCE_LABELS: Record<IngestSource, string> = { server: 'Server', browser: 'Browser' };

export const STATUS_COPY: Record<IntegrationStatus, { label: string; tone: Tone }> = {
  healthy: { label: 'Healthy', tone: 'success' },
  stale: { label: 'Stale', tone: 'warning' },
  never: { label: 'No events yet', tone: 'muted' },
};

export interface WarningCopy {
  title: string;
  description: string;
  tone: Exclude<Tone, 'success' | 'muted'>;
  chapter: GuideChapter;
}

const percent = (ratio: number) => `${Math.round(ratio * 100)} %`;

export const WARNING_COPY: Record<IntegrationWarning, WarningCopy> = {
  exposed_key: {
    title: 'Secret key exposed',
    description: `A secret key was sent from a browser. Treat it as leaked: issue a new key on the ${navLabel('apps')} page, deploy it, then revoke the old one.`,
    tone: 'destructive',
    chapter: 'keys',
  },
  pii_detected: {
    title: 'Personal data redacted',
    description:
      'Emails, phone, PAN, GSTIN or Aadhaar numbers arrived in paths, labels or props. Nexus replaced them before storing, but the sender must stop sending them — the fields are listed below.',
    tone: 'destructive',
    chapter: 'pii',
  },
  app_disabled: {
    title: 'App disabled',
    description:
      'Every event from this app is refused (APP_DISABLED) until an admin re-enables it.',
    tone: 'destructive',
    chapter: 'troubleshooting',
  },
  never_received: {
    title: 'No events received',
    description:
      'Nothing has arrived for this app yet. Run the verify steps: check the key, dry run, then send one event.',
    tone: 'warning',
    chapter: 'verify',
  },
  stale: {
    title: 'No recent events',
    description: `Nothing arrived in the last ${Math.round(INTEGRATION_STALE_AFTER_MS / MS_PER_HOUR)} hours. Is the middleware still mounted and NEXUS_URL set in this environment?`,
    tone: 'warning',
    chapter: 'troubleshooting',
  },
  private_ips: {
    title: 'Proxy IPs instead of users',
    description: `More than ${percent(PRIVATE_IP_RATIO_THRESHOLD)} of server events carry a private IP (your proxy, not the user), so places (country and city) stay empty for this app on the dashboard. Set trustProxyHops to the number of proxies in front of the app.`,
    tone: 'warning',
    chapter: 'clientIp',
  },
  clock_skew: {
    title: 'Sender clock is off',
    description: `An SDK's clock differs from ours by more than ${Math.round(CLOCK_SKEW_WARN_MS / MS_PER_SECOND)} s. Enable NTP on the sending host, or events may be rejected.`,
    tone: 'warning',
    chapter: 'verify',
  },
  rejected_events: {
    title: 'Events rejected',
    description: 'Some events failed validation. The 202 answer lists rejected[].code per event.',
    tone: 'warning',
    chapter: 'responses',
  },
  rate_limited: {
    title: 'Rate limited',
    description:
      'Some batches were refused with 429. Batch more events per request and honour Retry-After.',
    tone: 'warning',
    chapter: 'responses',
  },
};

// ─── Integration level (ADR 0013) ───────────────────────────────────────────

export type LevelTone = 'muted' | 'warning' | 'info' | 'success';

export interface LevelCopy {
  label: string;
  tone: LevelTone;
  /** What the level means and what is missing for the next one. */
  description: string;
}

export const LEVEL_COPY: Record<IntegrationLevel, LevelCopy> = {
  not_connected: {
    label: 'Not connected',
    tone: 'muted',
    description: 'No event has arrived yet. Follow the verify steps.',
  },
  partial: {
    label: 'Partial',
    tone: 'warning',
    description:
      'Only one source sends (server or browser), or nothing arrived recently. Wire up the other one.',
  },
  connected: {
    label: 'Connected',
    tone: 'info',
    description: `Both sources send. Fully integrated also needs ${percent(COVERAGE_TARGET_RATIO)} of API calls linked and of browser events identified, ${percent(RELEASE_COVERAGE_TARGET)} release-tagged events per source and no key, PII or disabled-app warning.`,
  },
  complete: {
    label: 'Fully integrated',
    tone: 'success',
    description:
      'Both sources send, calls link to pages, users are identified and releases tagged.',
  },
};

// ─── SSO cookie diagnostics ─────────────────────────────────────────────────

/** Why browser beacons are (not) identified — one line per verify outcome, with the fix. */
export const SSO_OUTCOME_COPY: Record<SsoCookieOutcome, string> = {
  ok: 'The SSO cookie verified: beacons carry the signed-in user.',
  'no-cookie':
    'No access_token cookie reached Nexus: check the cookie’s Path, Domain and SameSite (it must be sent to the Nexus origin), or the user is signed out.',
  'no-secret': 'Nexus has no LIBAS_JWT_SECRET configured, so it cannot verify the cookie.',
  malformed: 'The cookie is not a well-formed token.',
  'bad-alg': 'The token is signed with an algorithm the portal does not use.',
  'bad-signature':
    'The signature does not match: LIBAS_JWT_SECRET differs between the portal and Nexus.',
  expired:
    'The token had expired: normal for idle tabs; frequent means tokens are not being refreshed.',
  'not-yet-valid': 'The token is not valid yet: the portal’s and Nexus’s clocks differ.',
  'wrong-type': 'The cookie holds a token that is not an access token.',
  'no-email': 'The cookie verified, but its email is missing or not plausible.',
};

export const BEACON_ORIGIN_LABELS: Record<BeaconOrigin, string> = {
  same_origin: 'same origin',
  cross_origin: 'cross origin',
  none: 'no Origin header',
};

// ─── Rejections and PII ─────────────────────────────────────────────────────

/** What each rejection code means for the sender (the 202 answer lists it per event). */
export const REJECTION_CODE_COPY: Record<IngestRejectionCode, string> = {
  INVALID_EVENT: 'The event failed validation: see the field; fix the sender’s payload.',
  EVENT_TIME_OUT_OF_RANGE:
    'occurredAt was too far in the past or future: check the sender’s clock (NTP) and retry queue.',
  PATH_OUTSIDE_APP: `The page path is outside the app’s base path: check basePath on the ${navLabel('apps')} page.`,
  DB_CONSTRAINT: 'A value broke a database limit: the field names the constraint.',
  INVALID_ENVELOPE: 'The whole batch was malformed (server SDK): check the SDK version.',
  ORIGIN_NOT_ALLOWED: `A browser beacon came from an origin not in the app’s allowed origins (${navLabel('apps')} page).`,
};

export const PII_KIND_LABELS: Record<PiiKind, string> = {
  email: 'Email',
  phone: 'Phone number',
  pan: 'PAN',
  gstin: 'GSTIN',
  aadhaar: 'Aadhaar',
};

export const PII_FIELD_LABELS: Record<PiiField, string> = {
  path: 'Page or API path',
  route_template: 'Route template',
  referrer_path: 'Referrer path',
  label: 'Tool label',
  prop_key: 'Prop name',
  prop_value: 'Prop value',
  tool: 'Tool name',
  name: 'Event name',
  error_code: 'Error code',
  request_id: 'Request id',
  release: 'Release',
};

/**
 * Identity coverage is computed with ONE predicate everywhere; the pages differ only in scope.
 * Shown next to the per-source numbers so nobody compares the two pages' figures directly.
 */
export const IDENTITY_SCOPE_NOTE =
  'Applications shows identified events for both sources combined; this page shows each source on its own.';

/** Moved to lib/format.ts (every page shows relative times now); re-exported for this page. */
export { formatAgo } from '@/lib/format';

/** Signed clock skew: 120 → "+120 ms", -90_000 → "−90.0 s", null → "—". */
export function formatSkew(ms: number | null): string {
  if (ms === null) return EMPTY_VALUE;
  const sign = ms > 0 ? '+' : ms < 0 ? '−' : '';
  const abs = Math.abs(ms);
  return abs < MS_PER_SECOND ? `${sign}${abs} ms` : `${sign}${(abs / MS_PER_SECOND).toFixed(1)} s`;
}
