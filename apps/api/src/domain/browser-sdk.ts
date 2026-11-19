/**
 * The SDK label of a browser beacon or config poll, from its body's `client` block (browsers send no
 * X-Nexus-SDK header: sendBeacon cannot set headers). Recorded as api_keys.last_sdk and web_events.sdk.
 */

/** The `client` block shared by the browser envelope and the SDK config request. */
export interface BrowserClientBody {
  client?: { sdk: string; version: string };
}

/**
 * WHY one function: key auth (last_sdk), the config route and the controller (row sdk) must label a
 * browser SDK identically.
 */
export function browserSdkOf(body: BrowserClientBody): string | null {
  return body.client ? `${body.client.sdk}@${body.client.version}` : null;
}
