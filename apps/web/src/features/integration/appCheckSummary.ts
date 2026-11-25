import type { AppIntegrationHealthDto, IngestSource } from '@nexus/shared';

import { formatPercent } from '@/lib/format';
import type { GuideChapter } from '@/lib/guide';

import { STATUS_COPY, WARNING_COPY } from './integrationCopy';

/** Between the facts of the one-line summary. */
const SEPARATOR = ' · ';

/** The add-on whose version the summary names first: the browser one, else the server one. */
const SDK_SOURCE_ORDER: readonly IngestSource[] = ['browser', 'server'];

/** The highest identified share any source reached; null when no source has enough events. */
function bestIdentityRatio(health: AppIntegrationHealthDto): number | null {
  const ratios = health.identityCoverage
    .map((coverage) => coverage.ratio)
    .filter((ratio): ratio is number => ratio !== null);
  return ratios.length > 0 ? Math.max(...ratios) : null;
}

/** The version of the first add-on (SDK) seen, browser before server; null when none. */
function sdkVersionOf(health: AppIntegrationHealthDto): string | null {
  for (const source of SDK_SOURCE_ORDER) {
    const sdk = health.sdks.find((entry) => entry.source === source && entry.version !== null);
    if (sdk?.version) return sdk.version;
  }
  return null;
}

/**
 * WHY: a Data health row says in ONE line what the check found, so the list reads without
 * opening a row. With warnings that is the first warning's title (the API puts the worst first);
 * otherwise "Sending" (or the status when not healthy), the best identified share and the add-on
 * version — each fact skipped when unknown. Pure, so the wording is unit-tested.
 */
export function appCheckSummary(health: AppIntegrationHealthDto): string {
  const [firstWarning] = health.warnings;
  if (firstWarning) return WARNING_COPY[firstWarning].title;

  const parts = [health.status === 'healthy' ? 'Sending' : STATUS_COPY[health.status].label];
  const identified = bestIdentityRatio(health);
  if (identified !== null) parts.push(`people identified ${formatPercent(identified * 100, 0)}`);
  const version = sdkVersionOf(health);
  if (version) parts.push(`add-on ${version}`);
  return parts.join(SEPARATOR);
}

/** What the row's "How to fix" link needs: the guide chapter and the warning it fixes. */
export interface FirstFix {
  chapter: GuideChapter;
  /** The warning's own title, for the link's accessible name (never the whole summary). */
  warningTitle: string;
}

/**
 * WHY: the row's "How to fix" opens the guide chapter of the same first warning its summary
 * names, and is named after that warning, so its accessible name does not follow the summary's
 * wording; null when there is nothing to fix (the row then shows no link).
 */
export function firstFix(health: AppIntegrationHealthDto): FirstFix | null {
  const [firstWarning] = health.warnings;
  if (!firstWarning) return null;
  const copy = WARNING_COPY[firstWarning];
  return { chapter: copy.chapter, warningTitle: copy.title };
}
