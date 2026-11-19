import type { KeyKind } from '../constants/keys';
import type { SdkCaptureModule } from '../constants/traffic';

/** One API key of an app. The full secret is NEVER returned after creation (see KeyCreatedDto). */
export interface ApiKeyDto {
  id: string;
  kind: KeyKind;
  keyPrefix: string;
  label: string;
  /** Full publishable key (safe: it ships in browser bundles). Always null for secret keys. */
  publicKey: string | null;
  createdAt: string;
  createdBy: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastSdk: string | null;
  /** Set when this secret key was seen on the browser endpoint — rotate it. */
  exposedAt: string | null;
  revokedAt: string | null;
}

/**
 * The browser SDK's remote config of one app (ADR 0009), served to the SDK by
 * POST ROUTES.ingest.config. Not secret (every dashboard viewer sees apps.list).
 */
export interface SdkConfigDto {
  /** Bumped on every change; ROUTES.apps.updateSdkConfig sends it back as `expectedVersion`. */
  version: number;
  disabledModules: SdkCaptureModule[];
  /** null until the first change. */
  updatedAt: string | null;
}

/** GET ROUTES.apps.list item. */
export interface AppDto {
  slug: string;
  displayName: string;
  basePath: string | null;
  allowedOrigins: string[];
  isActive: boolean;
  /** Also the browser kill switch: off → every SDK stops (ingest and config answer 403). */
  browserIngestEnabled: boolean;
  sdkConfig: SdkConfigDto;
  createdAt: string;
  keys: ApiKeyDto[];
}

/** POST ROUTES.apps.create response. */
export type AppCreatedDto = AppDto;

/** POST ROUTES.apps.createKey response — the ONLY time the full key is shown. */
export interface KeyCreatedDto {
  key: ApiKeyDto;
  plaintextKey: string;
}
