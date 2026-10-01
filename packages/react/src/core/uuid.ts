/**
 * WHY: `crypto.randomUUID` only exists in secure contexts (HTTPS / localhost). Internal apps are
 * sometimes opened over plain http on an IP, so fall back to a v4 UUID from getRandomValues, and as
 * a last resort Math.random — an id is still better than a crash. NEVER throws.
 */
export function createUuid(): string {
  try {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    const bytes = new Uint8Array(16);
    if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
    else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    return formatUuidV4(bytes);
  } catch {
    return formatUuidV4(Uint8Array.from({ length: 16 }, () => Math.floor(Math.random() * 256)));
  }
}

/** WHY: sets the RFC 9562 version (4) and variant (10xx) bits the collector's validator checks. */
function formatUuidV4(bytes: Uint8Array): string {
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** WHY: values read back from storage may have been tampered with or written by an old version. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}
