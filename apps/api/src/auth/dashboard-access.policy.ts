/**
 * Injectable form of the shared dashboard access policy (same decision as the web proxy).
 */
import {
  decideDashboardAccess,
  type DashboardAccessDecision,
  type DashboardAccessPolicy as PolicyConfig,
} from '@nexus/auth';

export class DashboardAccessPolicy {
  constructor(private readonly policy: PolicyConfig) {}

  decide(email: string): DashboardAccessDecision {
    return decideDashboardAccess(email, this.policy);
  }
}
