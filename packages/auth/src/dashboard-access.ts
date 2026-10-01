/**
 * Who may open the dashboard, and who is an admin.
 *
 * WHY HERE: the web proxy (UX gate) and the API (real gate) MUST decide identically, so both call
 * this one pure function with the same env-derived policy. Fail-closed: an explicit email
 * allowlist wins; only when it is empty does the domain list apply. Admins are always allowed.
 */

export interface DashboardAccessPolicy {
  allowedEmails: readonly string[];
  allowedDomains: readonly string[];
  adminEmails: readonly string[];
}

export interface DashboardAccessDecision {
  allowed: boolean;
  isAdmin: boolean;
}

/** Parse a comma/space separated env list into lower-cased entries. */
export function parseList(value: string | undefined | null): string[] {
  return (value ?? '')
    .split(/[\s,]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

export function decideDashboardAccess(
  email: string,
  policy: DashboardAccessPolicy,
): DashboardAccessDecision {
  const normalized = email.trim().toLowerCase();
  const isAdmin = policy.adminEmails.includes(normalized);
  if (isAdmin) return { allowed: true, isAdmin: true };

  if (policy.allowedEmails.length > 0) {
    return { allowed: policy.allowedEmails.includes(normalized), isAdmin: false };
  }
  const domain = normalized.split('@')[1] ?? '';
  return { allowed: domain !== '' && policy.allowedDomains.includes(domain), isAdmin: false };
}
