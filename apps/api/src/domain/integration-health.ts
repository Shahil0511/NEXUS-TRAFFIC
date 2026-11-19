/**
 * Pure rules of the Integration page: an app's status, its private-IP share, its coverage KPIs
 * (identity, linking, release — ADR 0013), its integration level and its warnings.
 *
 * WHY separate from the service: these are the decisions other teams act on ("rotate this key",
 * "set trustProxyHops"), so each one is a small pure function with its own test, and the
 * thresholds come only from @nexus/shared (constants/integration.ts) — the same values the
 * dashboard and the public guide quote.
 */
import {
  CLOCK_SKEW_WARN_MS,
  COVERAGE_MIN_EVENTS,
  COVERAGE_TARGET_RATIO,
  INGEST_SOURCE_VALUES,
  INTEGRATION_STALE_AFTER_MS,
  INTEGRATION_WARNING_VALUES,
  PRIVATE_IP_MIN_EVENTS,
  PRIVATE_IP_RATIO_THRESHOLD,
  RELEASE_COVERAGE_TARGET,
  type CoverageDto,
  type IngestCounterDto,
  type IngestSource,
  type IntegrationLevel,
  type IntegrationStatus,
  type IntegrationWarning,
  type LinkingCoverageDto,
  type ReleaseStatusDto,
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
  const newest = Math.max(
    lastServerAt?.getTime() ?? -Infinity,
    lastBrowserAt?.getTime() ?? -Infinity,
  );
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

// ─── Coverage KPIs (ADR 0013) ───────────────────────────────────────────────

/** covered / events, rounded; null below COVERAGE_MIN_EVENTS (too little data for a verdict). */
export function coverageRatioOf(covered: number, events: number): number | null {
  if (events < COVERAGE_MIN_EVENTS) return null;
  return roundTo(covered / events, RATIO_DECIMALS);
}

/** The SDK rows of one source. */
function rowsOfSource(sdkRows: readonly SdkHealthRow[], source: IngestSource): SdkHealthRow[] {
  return sdkRows.filter((row) => row.source === source);
}

/** Σ of one numeric column over rows. */
function sumOf(rows: readonly SdkHealthRow[], pick: (row: SdkHealthRow) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

/**
 * Verified-user share PER SOURCE (both sources, always; INGEST_SOURCE_VALUES order). The
 * Applications page shows the same IDENTIFIED_SQL predicate with both sources combined.
 */
export function identityCoverageOf(sdkRows: readonly SdkHealthRow[]): CoverageDto[] {
  return INGEST_SOURCE_VALUES.map((source) => {
    const rows = rowsOfSource(sdkRows, source);
    const events = sumOf(rows, (row) => row.events);
    const covered = sumOf(rows, (row) => row.identified);
    return { source, events, covered, ratio: coverageRatioOf(covered, events) };
  });
}

/** Linking of linkable API calls to browser sessions (browser rows contribute 0). */
export function linkingCoverageOf(sdkRows: readonly SdkHealthRow[]): LinkingCoverageDto {
  const linkable = sumOf(sdkRows, (row) => row.linkable);
  const linked = sumOf(sdkRows, (row) => row.linked);
  return {
    linkable,
    linked,
    pageViewLinked: sumOf(sdkRows, (row) => row.page_view_linked),
    ratio: coverageRatioOf(linked, linkable),
  };
}

/** The newest `latest_release` across the SDK rows of one source (by its event time). */
function latestReleaseOf(rows: readonly SdkHealthRow[]): string | null {
  let newest: SdkHealthRow | null = null;
  for (const row of rows) {
    if (row.latest_release === null || row.latest_release_at === null) continue;
    if (newest === null || row.latest_release_at > (newest.latest_release_at as Date)) newest = row;
  }
  return newest?.latest_release ?? null;
}

/** How many events of each source carry `release` (both sources, always). */
export function releaseStatusOf(sdkRows: readonly SdkHealthRow[]): ReleaseStatusDto[] {
  return INGEST_SOURCE_VALUES.map((source) => {
    const rows = rowsOfSource(sdkRows, source);
    const events = sumOf(rows, (row) => row.events);
    const withRelease = sumOf(rows, (row) => row.with_release);
    return {
      source,
      events,
      withRelease,
      ratio: coverageRatioOf(withRelease, events),
      latestRelease: latestReleaseOf(rows),
    };
  });
}

// ─── Integration level ──────────────────────────────────────────────────────

/** Warnings that keep an otherwise perfect integration from being `complete`. */
const BLOCKING_WARNINGS: readonly IntegrationWarning[] = [
  'exposed_key',
  'pii_detected',
  'app_disabled',
];

export interface LevelInputs {
  status: IntegrationStatus;
  identityCoverage: readonly CoverageDto[];
  linkingCoverage: LinkingCoverageDto;
  releases: readonly ReleaseStatusDto[];
  warnings: readonly IntegrationWarning[];
}

/** A ratio at or above its target; a null ratio (too few events) is NOT enough. */
function meets(ratio: number | null, target: number): boolean {
  return ratio !== null && ratio >= target;
}

/**
 * How far the integration has got (INTEGRATION_LEVEL_VALUES):
 * never → not_connected; stale or fewer than two sources with events in the window → partial;
 * both sources → connected; connected + linking and browser identity ≥ COVERAGE_TARGET_RATIO +
 * every source's release ratio ≥ RELEASE_COVERAGE_TARGET + no blocking warning → complete.
 */
export function integrationLevelOf(input: LevelInputs): IntegrationLevel {
  if (input.status === 'never') return 'not_connected';
  const activeSources = input.identityCoverage.filter((coverage) => coverage.events > 0).length;
  if (input.status === 'stale' || activeSources < INGEST_SOURCE_VALUES.length) return 'partial';
  const browserIdentity = input.identityCoverage.find((c) => c.source === 'browser')?.ratio ?? null;
  const complete =
    meets(input.linkingCoverage.ratio, COVERAGE_TARGET_RATIO) &&
    meets(browserIdentity, COVERAGE_TARGET_RATIO) &&
    input.releases.every((release) => meets(release.ratio, RELEASE_COVERAGE_TARGET)) &&
    !input.warnings.some((warning) => BLOCKING_WARNINGS.includes(warning));
  return complete ? 'complete' : 'connected';
}

// ─── Warnings ───────────────────────────────────────────────────────────────

export interface WarningInputs {
  isActive: boolean;
  status: IntegrationStatus;
  exposedKeys: number;
  /** Σ detections of the ingest PII scrubber in the window (traffic.pii_detections). */
  piiDetections: number;
  privateIpRatio: number | null;
  sdks: readonly SdkHealthDto[];
  counters: readonly IngestCounterDto[];
}

/** Each warning's condition, keyed by code (the order comes from INTEGRATION_WARNING_VALUES). */
const WARNING_RULES: Readonly<Record<IntegrationWarning, (input: WarningInputs) => boolean>> = {
  exposed_key: (i) => i.exposedKeys > 0,
  pii_detected: (i) => i.piiDetections > 0,
  app_disabled: (i) => !i.isActive,
  never_received: (i) => i.status === 'never',
  stale: (i) => i.status === 'stale',
  private_ips: (i) => i.privateIpRatio !== null && i.privateIpRatio > PRIVATE_IP_RATIO_THRESHOLD,
  clock_skew: (i) =>
    i.sdks.some(
      (sdk) =>
        sdk.medianClockSkewMs !== null && Math.abs(sdk.medianClockSkewMs) > CLOCK_SKEW_WARN_MS,
    ),
  rejected_events: (i) => i.counters.some((counter) => counter.rejected > 0),
  rate_limited: (i) => i.counters.some((counter) => counter.rateLimited > 0),
};

/** The app's warnings, most urgent first (INTEGRATION_WARNING_VALUES order). */
export function integrationWarningsOf(input: WarningInputs): IntegrationWarning[] {
  return INTEGRATION_WARNING_VALUES.filter((code) => WARNING_RULES[code](input));
}
