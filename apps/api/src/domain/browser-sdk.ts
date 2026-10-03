/**
 * The SDK label of a browser beacon, from its envelope's `client` block (browsers send no
 * X-Nexus-SDK header: sendBeacon cannot set headers). Recorded as api_keys.last_sdk and web_events.sdk.
 */
import type { BrowserIngestEnvelope } from '@nexus/shared';

/** WHY one function: key auth (last_sdk) and the controller (row sdk) must label a beacon identically. */
export function browserSdkOf(envelope: Pick<BrowserIngestEnvelope, 'client'>): string | null {
  return envelope.client ? `${envelope.client.sdk}@${envelope.client.version}` : null;
}
