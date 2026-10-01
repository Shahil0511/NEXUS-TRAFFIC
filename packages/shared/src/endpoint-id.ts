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
