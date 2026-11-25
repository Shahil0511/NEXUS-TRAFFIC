import { accessPolicyOf, type WebEnv } from '@/env.schema';

/**
 * Who may open the dashboard, as one of four outcomes: a named list of viewers (plus the admins),
 * admins only, everyone of the allowed company domains, or unknown (the env could not be read).
 */
export type DashboardAccess = 'listed' | 'adminsOnly' | 'wholeDomain' | 'unknown';

/**
 * WHY: the Data health page shows a "Who can open this dashboard" check, red when anyone with a
 * company email gets in. It folds the policy the same way the shared rule decides a sign-in:
 * a non-empty email list wins, only then does the domain list apply, admins always pass.
 *
 * It reads the WEB server's env (DASHBOARD_ALLOWED_EMAILS / DASHBOARD_ALLOWED_DOMAINS). The API's
 * real gate reads the same keys from ITS OWN env, so both containers MUST be set alike; this never
 * reads the API env. Server-safe and pure: ONLY the enum crosses to the client, NEVER an email or
 * a domain. `env` is null when the web env could not be parsed → 'unknown'.
 *
 * @see ../../../../../packages/auth/src/dashboard-access.ts   decideDashboardAccess (the rule it mirrors)
 */
export function dashboardAccessOf(env: WebEnv | null): DashboardAccess {
  if (env === null) return 'unknown';
  const policy = accessPolicyOf(env);
  if (policy.allowedEmails.length > 0) return 'listed';
  if (policy.allowedDomains.length > 0) return 'wholeDomain';
  return 'adminsOnly';
}
