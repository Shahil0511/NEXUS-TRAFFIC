/**
 * Resolve the end-user IP from X-Forwarded-For using a TRUSTED hop count.
 *
 * WHY: nginx appends the real client to whatever X-Forwarded-For the client sent
 * (`$proxy_add_x_forwarded_for`), so the LEFTMOST entry is attacker-controlled. The only safe
 * reading walks from the right: with `trustProxyHops` proxies in front of the app, the client is
 * `trustProxyHops` positions left of the socket peer.
 *
 *   chain = [...xff entries, remoteAddress]
 *   client = chain[chain.length - 1 - trustProxyHops]
 *
 * Examples: gateway → app = 1 hop; gateway → Next.js → API = 2 hops.
 * Used by the API (for browser beacons) and re-exported by the reference SDKs.
 * ZERO dependencies.
 */

/** Strip the IPv4-mapped IPv6 prefix and surrounding whitespace. */
export function normalizeIp(value: string): string {
  const trimmed = value.trim();
  return trimmed.toLowerCase().startsWith('::ffff:') && trimmed.includes('.')
    ? trimmed.slice(7)
    : trimmed;
}

export function resolveClientIp(
  xForwardedFor: string | string[] | undefined | null,
  remoteAddress: string | undefined | null,
  trustProxyHops: number,
): string | null {
  const forwarded = (Array.isArray(xForwardedFor) ? xForwardedFor.join(',') : (xForwardedFor ?? ''))
    .split(',')
    .map(normalizeIp)
    .filter((entry) => entry.length > 0);
  const chain = remoteAddress ? [...forwarded, normalizeIp(remoteAddress)] : forwarded;
  if (chain.length === 0) return null;
  const hops = Math.max(0, Math.floor(trustProxyHops));
  const index = Math.max(0, chain.length - 1 - hops);
  return chain[index] ?? null;
}
