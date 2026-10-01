/**
 * Read one cookie from a raw `Cookie` header (Express, Socket.io handshake, beacons).
 * Next.js code uses `request.cookies` instead.
 */
export function readCookie(cookieHeader: string | undefined | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const pair of cookieHeader.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() !== name) continue;
    const raw = pair.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}
