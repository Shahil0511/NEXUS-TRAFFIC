import type { EnvironmentFilter } from '@nexus/shared';

/**
 * WHY: one name per ENVIRONMENT_FILTER_VALUES entry (ADR 0008) — the top-bar filter, breakdowns
 * and the Integration page's environment mix say "Production", never the raw `prod`.
 */
export const ENVIRONMENT_LABELS: Record<EnvironmentFilter, string> = {
  prod: 'Production',
  staging: 'Staging',
  dev: 'Development',
  all: 'All environments',
};
