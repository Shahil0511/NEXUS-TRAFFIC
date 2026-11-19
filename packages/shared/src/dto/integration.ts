import type {
  IntegrationLevel,
  IntegrationStatus,
  IntegrationWarning,
} from '../constants/integration';
import type { PiiField, PiiKind } from '../constants/pii';
import type {
  BeaconOrigin,
  Environment,
  IngestSource,
  SsoCookieOutcome,
} from '../constants/traffic';
import type { IngestRejectionCode } from '../errors';

/** Ingest bookkeeping of one source over the health window (from `traffic.ingest_counters`). */
export interface IngestCounterDto {
  source: IngestSource;
  accepted: number;
  duplicates: number;
  rejected: number;
  rateLimited: number;
}

/**
 * One SDK (as `name@version`, e.g. `@nexus/express@1.0.0`) seen on one source in the window.
 * `sdk` is null for senders that announce no SDK (no envelope `sdk` / `client`, no X-Nexus-SDK).
 * Clock skew = received_at − sentAt in ms (positive: the sender's clock is behind ours).
 */
export interface SdkHealthDto {
  source: IngestSource;
  sdk: string | null;
  /** `sdk` split at its last '@' after index 0 (`@nexus/express`); null when unsplittable. */
  name: string | null;
  /** `sdk` after that '@' (`1.0.0`); null when unsplittable. */
  version: string | null;
  events: number;
  lastSeenAt: string;
  medianClockSkewMs: number | null;
  maxAbsClockSkewMs: number | null;
}

/** A SECRET key that was sent to the browser endpoint and still works — rotate it. */
export interface ExposedKeyDto {
  id: string;
  keyPrefix: string;
  label: string;
  exposedAt: string;
}

/**
 * Share of one source's events that carry something (e.g. a VERIFIED user). `ratio` = covered /
 * events, null below COVERAGE_MIN_EVENTS events.
 */
export interface CoverageDto {
  source: IngestSource;
  events: number;
  covered: number;
  ratio: number | null;
}

/**
 * Linking of API calls to browser sessions. `linkable` = http calls from browser-capable devices
 * (LINKABLE_DEVICE_CLASSES); `linked` carry a session id, `pageViewLinked` a page-view id.
 * `ratio` = linked / linkable, null below COVERAGE_MIN_EVENTS linkable calls.
 */
export interface LinkingCoverageDto {
  linkable: number;
  linked: number;
  pageViewLinked: number;
  ratio: number | null;
}

/** Events per environment and source in the window (Integration Health is NOT env-filtered). */
export interface EnvironmentMixDto {
  source: IngestSource;
  environment: Environment;
  events: number;
}

/** How many of one source's events carry `release`; `ratio` null below COVERAGE_MIN_EVENTS. */
export interface ReleaseStatusDto {
  source: IngestSource;
  events: number;
  withRelease: number;
  ratio: number | null;
  /** The release of the newest event that had one. */
  latestRelease: string | null;
}

/** Redactions by the ingest PII scrubber (traffic.pii_detections) — counts only, never values. */
export interface PiiDetectionDto {
  source: IngestSource;
  field: PiiField;
  kind: PiiKind;
  detections: number;
}

/**
 * Why events were refused (traffic.ingest_rejections). `sdk` / `schemaPath` null = not known
 * (stored as ''). `schemaPath` is the normalised zod issue path — never the message.
 */
export interface RejectionReasonDto {
  source: IngestSource;
  sdk: string | null;
  code: IngestRejectionCode;
  schemaPath: string | null;
  rejected: number;
}

/** SSO cookie verification outcomes of browser batches (traffic.sso_cookie_outcomes). */
export interface SsoCookieOutcomeDto {
  outcome: SsoCookieOutcome;
  beaconOrigin: BeaconOrigin;
  beacons: number;
}

/** One app's wiring status — what other teams check after integrating. */
export interface AppIntegrationHealthDto {
  app: string;
  displayName: string;
  isActive: boolean;
  status: IntegrationStatus;
  lastServerEventAt: string | null;
  lastBrowserEventAt: string | null;
  /** Busiest first. */
  sdks: SdkHealthDto[];
  /** Always one entry per source (zeros when nothing was counted). */
  counters: IngestCounterDto[];
  exposedKeys: ExposedKeyDto[];
  /**
   * Share 0..1 of the window's server events whose IP was private/loopback (proxy misconfig hint);
   * null below PRIVATE_IP_MIN_EVENTS events with a classified IP.
   */
  privateIpRatio: number | null;
  /** Most urgent first (INTEGRATION_WARNING_VALUES order). */
  warnings: IntegrationWarning[];
  /** Verified-user share, one entry per source (always both). */
  identityCoverage: CoverageDto[];
  linkingCoverage: LinkingCoverageDto;
  environments: EnvironmentMixDto[];
  /** One entry per source (always both). */
  releases: ReleaseStatusDto[];
  /** Busiest first. */
  piiDetections: PiiDetectionDto[];
  /** Busiest first, at most MAX_REJECTION_ROWS_PER_APP. */
  rejections: RejectionReasonDto[];
  ssoCookieOutcomes: SsoCookieOutcomeDto[];
  /** How far the integration has got (INTEGRATION_LEVEL_VALUES). */
  level: IntegrationLevel;
}

/** GET ROUTES.integration.health — every registered app, by slug. */
export interface IntegrationHealthDto {
  /** The trailing window of counters / SDKs / skew / IP ratio (INTEGRATION_HEALTH_WINDOW_MS). */
  from: string;
  to: string;
  apps: AppIntegrationHealthDto[];
}
