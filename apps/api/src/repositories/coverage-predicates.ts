/**
 * The ONE definition of the coverage KPIs in SQL (ADR 0013): identified, linkable, linked and
 * page-view-linked rows. Every KPI that shows one of these numbers builds it from here, so the
 * Applications page (both sources combined) and Integration Health (per source) can never disagree
 * on what "identified" or "linked" means.
 *
 * Consumers:
 * - WebEventQueryRepository.summarizeActivityByApp → IDENTIFIED_SQL (Applications "identified %")
 * - ApiRequestQueryRepository.summarizeTrafficByApp → LINKABLE_SQL / LINKED_SQL ("linked %")
 * - IngestHealthRepository (sdkHealthSql) → all four, per (app, source, sdk)
 *
 * Every literal comes from a typed constant (never input); `alias` MUST be a trusted identifier.
 * @see ../../migrations/0004_api_requests.sql (kind, ua_device, session_id, page_view_id, user_key)
 * @see ../../migrations/0005_web_events.sql (user_key)
 */
import { LINKABLE_DEVICE_CLASSES, type ServerEventKind } from '@nexus/shared';

/** The only server event kind a browser page can cause (streams / downloads never carry headers). */
const HTTP_KIND: ServerEventKind = 'http';
const LINKABLE_DEVICE_LIST = LINKABLE_DEVICE_CLASSES.map((device) => `'${device}'`).join(', ');

/**
 * A row with a VERIFIED user (`user_key IS NOT NULL` ⇔ sso_cookie / app_attested — the CHECKs of
 * 0004/0005 guarantee it). Claims never count. Works on both event tables.
 */
export function IDENTIFIED_SQL(alias: string): string {
  return `${alias}.user_key IS NOT NULL`;
}

/**
 * An API call that COULD carry the tracker's session headers: an http call from a browser-capable
 * device (LINKABLE_DEVICE_CLASSES). SSR, server-to-server calls, bots and streams are excluded,
 * so they never drag the linking ratio down. api_requests only.
 */
export function LINKABLE_SQL(alias: string): string {
  return `(${alias}.kind = '${HTTP_KIND}' AND ${alias}.ua_device IN (${LINKABLE_DEVICE_LIST}))`;
}

/** A linkable API call that carries a browser session id (X-Nexus-Session). api_requests only. */
export function LINKED_SQL(alias: string): string {
  return `(${LINKABLE_SQL(alias)} AND ${alias}.session_id IS NOT NULL)`;
}

/** A linkable API call that carries a page-view id (X-Nexus-Page-View). api_requests only. */
export function PAGE_VIEW_LINKED_SQL(alias: string): string {
  return `(${LINKABLE_SQL(alias)} AND ${alias}.page_view_id IS NOT NULL)`;
}
