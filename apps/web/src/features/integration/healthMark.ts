import type { AppIntegrationHealthDto } from '@nexus/shared';

import type { CheckState } from '@/components/HealthMark';

import { WARNING_COPY } from './integrationCopy';

/** What a Data health mark says, per state (the visible or screen-reader label). */
export const HEALTH_MARK_COPY: Record<CheckState, string> = {
  pass: 'Healthy',
  warn: 'Needs attention',
  fail: 'Action needed',
};

/**
 * WHY: one app's Data health in one mark, so a list (the Apps table) can show it beside the app
 * without the full Integration card. The API decides status and warnings
 * (apps/api/src/domain/integration-health.ts); this only folds them, using the tone the
 * Integration page already gives each warning (WARNING_COPY) so both pages agree:
 * fail = disabled app or a red warning; warn = not healthy or any other warning; else pass.
 */
export function healthMarkOf(health: AppIntegrationHealthDto): CheckState {
  if (!health.isActive) return 'fail';
  if (health.warnings.some((code) => WARNING_COPY[code].tone === 'destructive')) return 'fail';
  if (health.status !== 'healthy' || health.warnings.length > 0) return 'warn';
  return 'pass';
}
