import type { IngestSource } from '../constants/traffic';

export interface IngestCounterDto {
  source: IngestSource;
  accepted: number;
  duplicates: number;
  rejected: number;
  rateLimited: number;
}

/** One app's wiring status — what other teams check after integrating. */
export interface AppIntegrationHealthDto {
  app: string;
  displayName: string;
  isActive: boolean;
  lastServerEventAt: string | null;
  lastBrowserEventAt: string | null;
  sdkVersions: string[];
  counters24h: IngestCounterDto[];
  exposedKeys: number;
  /** Share 0..1 of last-24h server events whose IP was private/loopback (proxy misconfig hint). */
  privateIpRatio: number | null;
  warnings: string[];
}

/** GET ROUTES.integration.health */
export interface IntegrationHealthDto {
  apps: AppIntegrationHealthDto[];
}
