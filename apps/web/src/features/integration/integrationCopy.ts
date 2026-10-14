/**
 * What the Integration page SAYS about a status or a warning, and which guide chapter fixes it.
 *
 * WHY one table: the API decides (apps/api/src/domain/integration-health.ts, thresholds in
 * @nexus/shared constants/integration.ts); this file only explains. A `Record` over the shared
 * value lists makes a new code a compile error until it has copy.
 */
import {
  CLOCK_SKEW_WARN_MS,
  INTEGRATION_STALE_AFTER_MS,
  PRIVATE_IP_RATIO_THRESHOLD,
  type IntegrationStatus,
  type IntegrationWarning,
} from '@nexus/shared';

import { EMPTY_VALUE } from '@/lib/format';
import type { GuideChapter } from '@/lib/guide';

export type Tone = 'success' | 'warning' | 'destructive' | 'muted';

const MS_PER_SECOND = 1000;
const MS_PER_HOUR = 3_600_000;

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
    description:
      'A secret key was sent from a browser. Treat it as leaked: issue a new key on the Apps page, deploy it, then revoke the old one.',
    tone: 'destructive',
    chapter: 'keys',
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
    description: `More than ${percent(PRIVATE_IP_RATIO_THRESHOLD)} of server events carry a private IP (your proxy, not the user), so Geography and location stay empty for this app on the dashboard. Set trustProxyHops to the number of proxies in front of the app.`,
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

/** Moved to lib/format.ts (every page shows relative times now); re-exported for this page. */
export { formatAgo } from '@/lib/format';

/** Signed clock skew: 120 → "+120 ms", -90_000 → "−90.0 s", null → "—". */
export function formatSkew(ms: number | null): string {
  if (ms === null) return EMPTY_VALUE;
  const sign = ms > 0 ? '+' : ms < 0 ? '−' : '';
  const abs = Math.abs(ms);
  return abs < MS_PER_SECOND ? `${sign}${abs} ms` : `${sign}${(abs / MS_PER_SECOND).toFixed(1)} s`;
}
