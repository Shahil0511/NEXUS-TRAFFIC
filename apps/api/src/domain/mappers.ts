/**
 * Row → DTO mappers: the ONLY place snake_case PostgreSQL rows become the camelCase DTOs of
 * @nexus/shared. Dates leave the API as ISO-8601 strings.
 */
import type { ApiKeyDto, AppDto } from '@nexus/shared';

import type { ApiKeyRow, AppRow } from './rows';

/** WHY: nullable timestamp columns map to `string | null` in every DTO. */
function isoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/**
 * WHY: the Apps page lists keys without ever exposing a secret. `key_hash` is NEVER copied; the
 * full key only exists in `publicKey` for publishable keys (they ship in bundles anyway).
 * @see ../../migrations/0002_apps_and_api_keys.sql
 */
export function mapApiKey(row: ApiKeyRow): ApiKeyDto {
  return {
    id: row.id,
    kind: row.kind,
    keyPrefix: row.key_prefix,
    label: row.label,
    publicKey: row.kind === 'publishable' ? row.public_key : null,
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by,
    expiresAt: isoOrNull(row.expires_at),
    lastUsedAt: isoOrNull(row.last_used_at),
    lastSdk: row.last_sdk,
    exposedAt: isoOrNull(row.exposed_at),
    revokedAt: isoOrNull(row.revoked_at),
  };
}

/**
 * WHY: an app is shown by its public slug (the internal uuid never leaves the API) together with
 * its keys. `keys` must already belong to this app — grouping is the caller's job.
 * @see ../../migrations/0002_apps_and_api_keys.sql
 */
export function mapApp(row: AppRow, keys: ApiKeyRow[]): AppDto {
  return {
    slug: row.slug,
    displayName: row.display_name,
    basePath: row.base_path,
    allowedOrigins: [...row.allowed_origins],
    isActive: row.is_active,
    browserIngestEnabled: row.browser_ingest_enabled,
    createdAt: row.created_at.toISOString(),
    keys: keys.map(mapApiKey),
  };
}
