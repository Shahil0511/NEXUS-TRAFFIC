/**
 * Deterministic endpoint id: UUID v5 of `<appSlug> <METHOD> <routeTemplate>`.
 *
 * WHY: the dashboard links to an endpoint by an opaque id (no route strings in URLs), and the API
 * stores it on every api_requests row at ingest, so the detail page is one indexed lookup.
 * NODE-ONLY (node:crypto) — deliberately NOT exported from the package root barrel; import it as
 * `@nexus/shared/endpoint-id`.
 */
import { createHash } from 'node:crypto';

/** Fixed namespace for Data Nexus endpoint ids. NEVER change it (would re-key all history). */
export const ENDPOINT_ID_NAMESPACE = '6f1c2b4e-9d3a-5e8f-a7b1-0c2d4e6f8a9b';

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

function bytesToUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** RFC 9562 UUID version 5 (SHA-1, name-based). */
export function uuidV5(name: string, namespace: string): string {
  const hash = createHash('sha1')
    .update(uuidToBytes(namespace))
    .update(Buffer.from(name, 'utf8'))
    .digest()
    .subarray(0, 16);
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  return bytesToUuid(hash);
}

export function toEndpointId(appSlug: string, method: string, routeTemplate: string): string {
  return uuidV5(`${appSlug} ${method.toUpperCase()} ${routeTemplate}`, ENDPOINT_ID_NAMESPACE);
}

/** Namespaces of page / tool ids. NEVER change them (would re-key every page/tool link). */
export const PAGE_ID_NAMESPACE = '46281c3e-02ab-44d8-9052-1787fb20a0d4';
export const TOOL_ID_NAMESPACE = '5d647b86-d35c-4f1e-9423-dff5cdcb9243';

/**
 * Opaque id of a page (app + path template) for dashboard URLs: the template is ingested text and
 * must never be a URL segment. Computed by the API from stored columns (not stored itself).
 */
export function toPageId(appSlug: string, pathTemplate: string): string {
  return uuidV5(`${appSlug} ${pathTemplate}`, PAGE_ID_NAMESPACE);
}

/** Opaque id of a tool (app + tool name) for dashboard URLs; same rules as toPageId. */
export function toToolId(appSlug: string, tool: string): string {
  return uuidV5(`${appSlug} ${tool}`, TOOL_ID_NAMESPACE);
}
