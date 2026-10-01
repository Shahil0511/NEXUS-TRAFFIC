/**
 * Cheap sanity check for an email-shaped identity (ported from EBO_SALES / stockapp proxy.ts).
 * Returns the normalized (trimmed, lower-cased) email, or null. A junk value is worse than none.
 */
export function plausibleEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim().toLowerCase();
  if (!candidate || candidate.length > 254) return null;
  if (/\s/.test(candidate)) return null;
  const parts = candidate.split('@');
  if (parts.length !== 2) return null;
  const [local, domain] = parts;
  if (!local || !domain) return null;
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return null;
  return candidate;
}

/**
 * The email claim of a verified token: `email`, else `preferred_username`, else `sub` —
 * each only if plausible (stockapp precedent; the portal sets `email`).
 */
export function extractEmail(claims: Record<string, unknown>): string | null {
  return (
    plausibleEmail(claims.email) ??
    plausibleEmail(claims.preferred_username) ??
    plausibleEmail(claims.sub)
  );
}
