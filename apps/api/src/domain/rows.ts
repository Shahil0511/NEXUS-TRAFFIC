/**
 * Row types exactly as SELECTed from PostgreSQL (snake_case). Mappers in ./mappers.ts turn them
 * into camelCase DTOs from @nexus/shared. Keep in sync with apps/api/migrations/*.sql.
 */
import type {
  AuditAction,
  IdentitySource,
  IngestSource,
  IpClass,
  KeyKind,
  ServerEventKind,
} from '@nexus/shared';

/** @see ../../migrations/0002_apps_and_api_keys.sql */
export interface AppRow {
  id: string;
  slug: string;
  display_name: string;
  base_path: string | null;
  allowed_origins: string[];
  is_active: boolean;
  browser_ingest_enabled: boolean;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

/** @see ../../migrations/0002_apps_and_api_keys.sql */
export interface ApiKeyRow {
  id: string;
  app_id: string;
  kind: KeyKind;
  key_prefix: string;
  key_hash: Buffer;
  public_key: string | null;
  label: string;
  created_by: string;
  created_at: Date;
  expires_at: Date | null;
  last_used_at: Date | null;
  last_sdk: string | null;
  exposed_at: Date | null;
  revoked_at: Date | null;
  revoked_by: string | null;
}

/** @see ../../migrations/0003_admin_audit_log.sql */
export interface AdminAuditRow {
  id: number;
  created_at: Date;
  actor_email: string;
  action: AuditAction;
  target_type: string;
  target_id: string;
  details: Record<string, unknown> | null;
}

/** @see ../../migrations/0004_api_requests.sql — the columns list endpoints SELECT. */
export interface ApiRequestRow {
  occurred_at: Date;
  event_id: string;
  app_slug: string;
  endpoint_id: string;
  kind: ServerEventKind;
  method: string;
  route_template: string;
  path: string;
  status_code: number;
  duration_ms: number;
  error_code: string | null;
  request_id: string | null;
  session_id: string | null;
  user_email: string | null;
  user_key: Buffer | null;
  claimed_email: string | null;
  identity_source: IdentitySource;
  ip: string | null;
  ip_class: IpClass;
  geo_country: string | null;
  geo_region: string | null;
  geo_city: string | null;
}

/** @see ../../migrations/0006_ingest_counters.sql */
export interface IngestCounterRow {
  app_id: string;
  source: IngestSource;
  bucket_hour: Date;
  accepted: number;
  duplicates: number;
  rejected: number;
  rate_limited: number;
}
