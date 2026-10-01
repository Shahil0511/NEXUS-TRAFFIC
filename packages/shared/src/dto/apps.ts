import type { KeyKind } from '../constants/keys';

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

/** GET ROUTES.apps.list item. */
export interface AppDto {
  slug: string;
  displayName: string;
  basePath: string | null;
  allowedOrigins: string[];
  isActive: boolean;
  browserIngestEnabled: boolean;
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
