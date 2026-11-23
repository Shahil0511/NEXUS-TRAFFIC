/**
 * PARITY: every enum CHECK in the database lists EXACTLY the values of its shared `*_VALUES` array,
 * and the key patterns/limits of the contract appear verbatim in their CHECKs. Adding an enum value
 * in packages/shared without a migration (or the reverse) fails here.
 * @see ../../../../packages/shared/src/constants/traffic.ts
 */
import {
  APP_SLUG_PATTERN,
  AUDIT_ACTION_VALUES,
  BEACON_ORIGIN_VALUES,
  BROWSER_EVENT_TYPE_VALUES,
  ENVIRONMENT_VALUES,
  ERROR_CODE_PATTERN,
  HTTP_METHOD_VALUES,
  IDENTIFIED_SOURCE_VALUES,
  IDENTITY_SOURCE_VALUES,
  INGEST_LIMITS,
  INGEST_REJECTION_CODE_VALUES,
  INGEST_SOURCE_VALUES,
  IP_CLASS_VALUES,
  KEY_KIND_VALUES,
  NAV_TYPE_VALUES,
  PAGE_TIME_REASON_VALUES,
  PERSON_ACCESS_SURFACE_VALUES,
  PII_FIELD_VALUES,
  PII_KIND_VALUES,
  SDK_CAPTURE_MODULE_VALUES,
  SERVER_EVENT_KIND_VALUES,
  SSO_COOKIE_OUTCOME_VALUES,
  TOOL_ACTION_VALUES,
  TOOL_NAME_PATTERN,
} from '@nexus/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RUN_DB_TESTS, createTestDatabase, type TestDatabase } from './test-database';

interface EnumCheck {
  table: string;
  constraint: string;
  values: readonly string[];
}

const ENUM_CHECKS: EnumCheck[] = [
  { table: 'api_requests', constraint: 'api_requests_identity_source_check', values: IDENTITY_SOURCE_VALUES },
  { table: 'web_events', constraint: 'web_events_identity_source_check', values: IDENTITY_SOURCE_VALUES },
  { table: 'api_requests', constraint: 'api_requests_identified_email_check', values: IDENTIFIED_SOURCE_VALUES },
  { table: 'web_events', constraint: 'web_events_identified_email_check', values: IDENTIFIED_SOURCE_VALUES },
  { table: 'api_requests', constraint: 'api_requests_kind_check', values: SERVER_EVENT_KIND_VALUES },
  { table: 'api_requests', constraint: 'api_requests_method_check', values: HTTP_METHOD_VALUES },
  { table: 'web_events', constraint: 'web_events_event_type_check', values: BROWSER_EVENT_TYPE_VALUES },
  { table: 'web_events', constraint: 'web_events_nav_check', values: NAV_TYPE_VALUES },
  { table: 'web_events', constraint: 'web_events_time_reason_check', values: PAGE_TIME_REASON_VALUES },
  { table: 'web_events', constraint: 'web_events_action_check', values: TOOL_ACTION_VALUES },
  { table: 'api_requests', constraint: 'api_requests_ip_class_check', values: IP_CLASS_VALUES },
  { table: 'web_events', constraint: 'web_events_ip_class_check', values: IP_CLASS_VALUES },
  { table: 'api_keys', constraint: 'api_keys_kind_check', values: KEY_KIND_VALUES },
  { table: 'admin_audit_log', constraint: 'admin_audit_log_action_check', values: AUDIT_ACTION_VALUES },
  { table: 'ingest_counters', constraint: 'ingest_counters_source_check', values: INGEST_SOURCE_VALUES },
  // ─── Phase A (0007–0012) ───
  { table: 'api_requests', constraint: 'api_requests_environment_check', values: ENVIRONMENT_VALUES },
  { table: 'web_events', constraint: 'web_events_environment_check', values: ENVIRONMENT_VALUES },
  { table: 'apps', constraint: 'apps_sdk_disabled_modules_check', values: SDK_CAPTURE_MODULE_VALUES },
  { table: 'ingest_rejections', constraint: 'ingest_rejections_source_check', values: INGEST_SOURCE_VALUES },
  { table: 'ingest_rejections', constraint: 'ingest_rejections_code_check', values: INGEST_REJECTION_CODE_VALUES },
  { table: 'pii_detections', constraint: 'pii_detections_source_check', values: INGEST_SOURCE_VALUES },
  { table: 'pii_detections', constraint: 'pii_detections_field_check', values: PII_FIELD_VALUES },
  { table: 'pii_detections', constraint: 'pii_detections_kind_check', values: PII_KIND_VALUES },
  { table: 'sso_cookie_outcomes', constraint: 'sso_cookie_outcomes_outcome_check', values: SSO_COOKIE_OUTCOME_VALUES },
  {
    table: 'sso_cookie_outcomes',
    constraint: 'sso_cookie_outcomes_beacon_origin_check',
    values: BEACON_ORIGIN_VALUES,
  },
  // ─── Phase B (0013) ───
  { table: 'person_access_log', constraint: 'person_access_log_surface_check', values: PERSON_ACCESS_SURFACE_VALUES },
];

/** Literal fragments that must appear in a constraint's definition. */
const TEXT_CHECKS: { table: string; constraint: string; contains: string }[] = [
  { table: 'apps', constraint: 'apps_slug_check', contains: `'${APP_SLUG_PATTERN.source}'` },
  { table: 'web_events', constraint: 'web_events_tool_check', contains: `'${TOOL_NAME_PATTERN.source}'` },
  { table: 'web_events', constraint: 'web_events_name_check', contains: `'${TOOL_NAME_PATTERN.source}'` },
  { table: 'api_requests', constraint: 'api_requests_error_code_check', contains: `'${ERROR_CODE_PATTERN.source}'` },
  { table: 'api_requests', constraint: 'api_requests_path_check', contains: `<= ${INGEST_LIMITS.maxStoredPathLength}` },
  { table: 'web_events', constraint: 'web_events_path_check', contains: `<= ${INGEST_LIMITS.maxStoredPathLength}` },
  {
    table: 'api_requests',
    constraint: 'api_requests_route_template_check',
    contains: `<= ${INGEST_LIMITS.maxRouteTemplateLength}`,
  },
  {
    table: 'web_events',
    constraint: 'web_events_path_template_check',
    contains: `<= ${INGEST_LIMITS.maxRouteTemplateLength}`,
  },
  { table: 'api_requests', constraint: 'api_requests_duration_ms_check', contains: `${INGEST_LIMITS.maxDurationMs}` },
  { table: 'web_events', constraint: 'web_events_visible_ms_check', contains: `${INGEST_LIMITS.maxVisibleMs}` },
  { table: 'api_requests', constraint: 'api_requests_release_check', contains: `<= ${INGEST_LIMITS.maxReleaseLength}` },
  {
    table: 'api_requests',
    constraint: 'api_requests_request_id_check',
    contains: `<= ${INGEST_LIMITS.maxRequestIdLength}`,
  },
  { table: 'web_events', constraint: 'web_events_label_check', contains: `<= ${INGEST_LIMITS.maxLabelLength}` },
  {
    table: 'web_events',
    constraint: 'web_events_referrer_host_check',
    contains: `<= ${INGEST_LIMITS.maxReferrerHostLength}`,
  },
  { table: 'api_requests', constraint: 'api_requests_user_email_check', contains: `<= ${INGEST_LIMITS.maxEmailLength}` },
  {
    table: 'api_requests',
    constraint: 'api_requests_claimed_email_check',
    contains: `<= ${INGEST_LIMITS.maxEmailLength}`,
  },
  // ─── Phase A (0007, 0010) ───
  { table: 'web_events', constraint: 'web_events_client_tz_check', contains: `<= ${INGEST_LIMITS.maxClientTzLength}` },
  {
    table: 'web_events',
    constraint: 'web_events_client_lang_check',
    contains: `<= ${INGEST_LIMITS.maxClientLangLength}`,
  },
  { table: 'web_events', constraint: 'web_events_release_check', contains: `<= ${INGEST_LIMITS.maxReleaseLength}` },
  {
    table: 'ingest_rejections',
    constraint: 'ingest_rejections_schema_path_check',
    contains: `<= ${INGEST_LIMITS.maxSchemaPathLength}`,
  },
];

/** `CHECK ((kind = ANY (ARRAY['http'::text, 'stream'::text])))` → ['http', 'stream']. */
function quotedLiterals(definition: string): string[] {
  return [...definition.matchAll(/'([^']*)'::text/g)].map((m) => m[1] ?? '');
}

describe.skipIf(!RUN_DB_TESTS)('schema parity with @nexus/shared (db)', () => {
  let db: TestDatabase;

  async function definitionOf(table: string, constraint: string): Promise<string> {
    const { rows } = await db.ownerPool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(c.oid) AS def
         FROM pg_catalog.pg_constraint c
        WHERE c.conrelid = format('traffic.%I', $1::text)::regclass
          AND c.conname = $2`,
      [table, constraint],
    );
    const def = rows[0]?.def;
    if (!def) throw new Error(`constraint ${table}.${constraint} not found`);
    return def;
  }

  beforeAll(async () => {
    db = await createTestDatabase('parity');
  });

  afterAll(async () => {
    await db?.drop();
  });

  it.each(ENUM_CHECKS)('$constraint lists exactly the shared values', async ({ table, constraint, values }) => {
    const literals = quotedLiterals(await definitionOf(table, constraint));
    expect([...literals].sort()).toEqual([...values].sort());
  });

  it.each(TEXT_CHECKS)('$constraint contains $contains', async ({ table, constraint, contains }) => {
    expect(await definitionOf(table, constraint)).toContain(contains);
  });

  it('the page_view_id index exists on api_requests and on its partitions (0008)', async () => {
    const { rows } = await db.ownerPool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_catalog.pg_indexes
        WHERE schemaname = 'traffic' AND indexdef LIKE '%(page_view_id)%'
          AND (indexname = 'idx_api_requests_page_view_id' OR tablename LIKE 'api_requests_y%')`,
    );
    const tables = rows.map((r) => r.tablename);
    expect(tables).toContain('api_requests');
    expect(tables.some((t) => /^api_requests_y\d{4}m\d{2}$/.test(t))).toBe(true);
  });

  it('both event tables carry every ActorColumns column (domain/inserts.ts)', async () => {
    const { rows } = await db.ownerPool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'traffic' AND table_name IN ('api_requests', 'web_events')`,
    );
    const columnsOf = (t: string) => new Set(rows.filter((r) => r.table_name === t).map((r) => r.column_name));
    const actorColumns = [
      'user_email', 'user_key', 'claimed_email', 'identity_source', 'ip', 'ip_hash', 'ip_class',
      'geo_country', 'geo_region', 'geo_city', 'geo_lat', 'geo_lon', 'ua_browser', 'ua_os', 'ua_device', 'sdk',
    ];
    for (const table of ['api_requests', 'web_events']) {
      for (const column of actorColumns) expect(columnsOf(table).has(column), `${table}.${column}`).toBe(true);
    }
  });
});
