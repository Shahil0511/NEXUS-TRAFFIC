/**
 * What the breakdown panels SAY about a dimension and its values.
 *
 * WHY one table: ROUTES.overview.breakdown answers with raw column values (`desktop`, `route`,
 * `hidden`, `prod`, a time zone…). Known enum values get a plain-language name here; anything
 * else is ingested text and is shown AS TEXT, verbatim — never as a link, never as markup.
 * A `Record` over BREAKDOWN_DIMENSION_VALUES makes a new dimension a compile error until it has copy.
 */
import {
  BREAKDOWN_DIMENSION_VALUES,
  SERVER_BREAKDOWN_DIMENSION_VALUES,
  type BreakdownDimension,
  type IngestSource,
  type NavType,
  type PageTimeReason,
} from '@nexus/shared';

import { ENVIRONMENT_LABELS } from '@/features/filters/environmentLabels';
import { formatOsName } from '@/lib/format';

export interface DimensionCopy {
  /** Name in the dimension picker and the list's accessible name. */
  label: string;
  /** One line under the panel title. */
  description: string;
}

export const DIMENSION_COPY: Record<BreakdownDimension, DimensionCopy> = {
  browser: { label: 'Browser', description: 'Page views by browser' },
  os: { label: 'Operating system', description: 'Page views by operating system' },
  device: { label: 'Device type', description: 'Page views by desktop, mobile or tablet' },
  referrer_host: { label: 'Referrer', description: 'Where visitors came from (host only)' },
  nav: { label: 'Navigation', description: 'Full page loads versus in-app navigation' },
  time_reason: { label: 'Page-time end', description: 'Why the tracker stopped a page’s timer' },
  client_tz: { label: 'Time zone', description: 'Page views by the browser’s time zone' },
  client_lang: { label: 'Language', description: 'Page views by the browser’s language' },
  release: { label: 'Release', description: 'Events by the app’s release tag' },
  environment: { label: 'Environment', description: 'Events by environment' },
};

/** Shown for a null value: the event carried nothing for this dimension. */
export const NOT_SENT_LABEL = 'Not sent';

const DEVICE_LABELS: Readonly<Record<string, string>> = {
  desktop: 'Desktop',
  mobile: 'Mobile',
  tablet: 'Tablet',
  bot: 'Bot',
  other: 'Other',
};

const NAV_LABELS: Record<NavType, string> = {
  load: 'Full page load',
  route: 'In-app navigation',
};

const TIME_REASON_LABELS: Record<PageTimeReason, string> = {
  hidden: 'Tab hidden',
  route: 'Navigated in the app',
  pagehide: 'Page closed',
  idle: 'Went idle',
};

/** Known-value names per dimension (enum columns only; free text has none). */
const VALUE_LABELS: Partial<Record<BreakdownDimension, Readonly<Record<string, string>>>> = {
  device: DEVICE_LABELS,
  nav: NAV_LABELS,
  time_reason: TIME_REASON_LABELS,
  environment: ENVIRONMENT_LABELS,
};

/** Free-text dimensions whose values are tidied for display (the stored value is unchanged). */
const VALUE_FORMATTERS: Partial<Record<BreakdownDimension, (value: string) => string>> = {
  os: formatOsName,
};

/**
 * The text to show for one breakdown value: a known enum value's name, NOT_SENT_LABEL for null,
 * a tidied name for a formatted dimension (macOS without its frozen version), otherwise the value
 * itself (ingested text — the caller renders it as text only).
 */
export function breakdownValueLabel(dimension: BreakdownDimension, value: string | null): string {
  if (value === null) return NOT_SENT_LABEL;
  const formatter = VALUE_FORMATTERS[dimension];
  if (formatter) return formatter(value);
  const labels = VALUE_LABELS[dimension];
  // Own keys ONLY: an ingested value like `constructor` or `__proto__` must stay plain text, not
  // resolve to an Object.prototype member (a non-string React child crashes the panel).
  return labels && Object.hasOwn(labels, value) ? labels[value]! : value;
}

/** The dimensions ROUTES.overview.breakdown accepts for a source (server has fewer columns). */
export function dimensionsFor(source: IngestSource): readonly BreakdownDimension[] {
  return source === 'server' ? SERVER_BREAKDOWN_DIMENSION_VALUES : BREAKDOWN_DIMENSION_VALUES;
}
