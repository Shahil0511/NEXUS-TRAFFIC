/**
 * Pure rules of the Integration page: an app's status, its private-IP share and its warnings.
 *
 * WHY separate from the service: these are the decisions other teams act on ("rotate this key",
 * "set trustProxyHops"), so each one is a small pure function with its own test, and the
 * thresholds come only from @nexus/shared (constants/integration.ts) — the same values the
 * dashboard and the public guide quote.
 */
import {
  CLOCK_SKEW_WARN_MS,
  INGEST_SOURCE_VALUES,
  INTEGRATION_STALE_AFTER_MS,
  INTEGRATION_WARNING_VALUES,
  PRIVATE_IP_MIN_EVENTS,
  PRIVATE_IP_RATIO_THRESHOLD,
  type IngestCounterDto,
  type IntegrationStatus,
  type IntegrationWarning,
  type SdkHealthDto,
} from '@nexus/shared';

import { roundTo } from './numbers';
import type { SdkHealthRow } from './rows';

/** Decimals of `privateIpRatio` (0..1): 0.9234 → 0.923. */
const RATIO_DECIMALS = 3;

/** healthy / stale / never from the newest event of either source. */
export function integrationStatusOf(
  lastServerAt: Date | null,
  lastBrowserAt: Date | null,
  now: Date,
): IntegrationStatus {
  const newest = Math.max(lastServerAt?.getTime() ?? -Infinity, lastBrowserAt?.getTime() ?? -Infinity);
  if (newest === -Infinity) return 'never';
  return now.getTime() - newest > INTEGRATION_STALE_AFTER_MS ? 'stale' : 'healthy';
}

/**
 * Share of the app's SERVER events whose IP was private/loopback, over those with a classified IP.
 * Null below PRIVATE_IP_MIN_EVENTS (a handful of local test calls must not raise a warning).
 */
export function privateIpRatioOf(sdkRows: readonly SdkHealthRow[]): number | null {
  let privateEvents = 0;
  let classified = 0;
  for (const row of sdkRows) {
    if (row.source !== 'server') continue;
    privateEvents += row.private_ip_events;
    classified += row.classified_ip_events;
  }
  if (classified < PRIVATE_IP_MIN_EVENTS) return null;
  return roundTo(privateEvents / classified, RATIO_DECIMALS);
}

/** Both sources, in INGEST_SOURCE_VALUES order; a source with no counter row reads as zeros. */
export function countersBySource(counters: readonly IngestCounterDto[]): IngestCounterDto[] {
  return INGEST_SOURCE_VALUES.map(
    (source) =>
      counters.find((counter) => counter.source === source) ?? {
        source,
        accepted: 0,
        duplicates: 0,
        rejected: 0,
        rateLimited: 0,
      },
  );
}

export interface WarningInputs {
  isActive: boolean;
  status: IntegrationStatus;
  exposedKeys: number;
  privateIpRatio: number | null;
  sdks: readonly SdkHealthDto[];
  counters: readonly IngestCounterDto[];
}

/** Each warning's condition, keyed by code (the order comes from INTEGRATION_WARNING_VALUES). */
const WARNING_RULES: Readonly<Record<IntegrationWarning, (input: WarningInputs) => boolean>> = {
  exposed_key: (i) => i.exposedKeys > 0,
  app_disabled: (i) => !i.isActive,
  never_received: (i) => i.status === 'never',
  stale: (i) => i.status === 'stale',
  private_ips: (i) => i.privateIpRatio !== null && i.privateIpRatio > PRIVATE_IP_RATIO_THRESHOLD,
  clock_skew: (i) =>
    i.sdks.some(
      (sdk) => sdk.medianClockSkewMs !== null && Math.abs(sdk.medianClockSkewMs) > CLOCK_SKEW_WARN_MS,
    ),
  rejected_events: (i) => i.counters.some((counter) => counter.rejected > 0),
  rate_limited: (i) => i.counters.some((counter) => counter.rateLimited > 0),
};

/** The app's warnings, most urgent first (INTEGRATION_WARNING_VALUES order). */
export function integrationWarningsOf(input: WarningInputs): IntegrationWarning[] {
  return INTEGRATION_WARNING_VALUES.filter((code) => WARNING_RULES[code](input));
}
