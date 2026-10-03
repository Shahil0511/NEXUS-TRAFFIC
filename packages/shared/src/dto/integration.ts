import type { IntegrationStatus, IntegrationWarning } from '../constants/integration';
import type { IngestSource } from '../constants/traffic';

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
}

/** GET ROUTES.integration.health — every registered app, by slug. */
export interface IntegrationHealthDto {
  /** The trailing window of counters / SDKs / skew / IP ratio (INTEGRATION_HEALTH_WINDOW_MS). */
  from: string;
  to: string;
  apps: AppIntegrationHealthDto[];
}
