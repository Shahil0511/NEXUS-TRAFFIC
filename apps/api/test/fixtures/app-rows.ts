/**
 * Test-only row factories for `apps` / `api_keys` (shared by mapper, service and controller tests).
 */
import type { ApiKeyRow, AppRow } from '../../src/domain/rows';

export const APP_ID = '11111111-1111-4111-8111-111111111111';
export const KEY_ID = '22222222-2222-4222-8222-222222222222';
export const CREATED_AT = new Date('2026-09-01T10:00:00.000Z');

/** WHY: a fully-populated active app; override only what a test cares about. */
export function appRow(overrides: Partial<AppRow> = {}): AppRow {
  return {
    id: APP_ID,
    slug: 'ebo-sales',
    display_name: 'EBO Sales',
    base_path: '/ebo-sales',
    allowed_origins: ['https://nexus.libas.in'],
    is_active: true,
    browser_ingest_enabled: true,
    created_by: 'admin@libas.in',
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  };
}

/** WHY: a fully-populated active secret key; override only what a test cares about. */
export function apiKeyRow(overrides: Partial<ApiKeyRow> = {}): ApiKeyRow {
  return {
    id: KEY_ID,
    app_id: APP_ID,
    kind: 'secret',
    key_prefix: 'nx_sk_AbCdEfGh',
    key_hash: Buffer.alloc(32, 7),
    public_key: null,
    label: 'production',
    created_by: 'admin@libas.in',
    created_at: CREATED_AT,
    expires_at: null,
    last_used_at: null,
    last_sdk: null,
    exposed_at: null,
    revoked_at: null,
    revoked_by: null,
    ...overrides,
  };
}
