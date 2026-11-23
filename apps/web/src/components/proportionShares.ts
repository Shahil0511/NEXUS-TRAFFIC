/**
 * Pure helpers of ProportionBar (components/ProportionBar.tsx): share text, bar width and the "all other values" row.
 *
 * WHY separate: the wording rules are the point of the component ("30% of page views", never a
 * bare "30%", so nobody reads a share of page views as a share of people), and they are easier
 * to unit-test without rendering.
 */

const PERCENT = 100;
/** Below 1 % a rounded share would read "0%" although the value exists. */
const SMALL_SHARE = 0.01;
/** A non-zero bar is never thinner than this (percent of the track), so it stays visible. */
const MIN_VISIBLE_WIDTH_PCT = 1;

/** One labelled bar: `label` is shown AS TEXT (it may be ingested), `share` is 0..1 of the total. */
export interface ProportionRow {
  key: string;
  label: string;
  /** Rendered muted / italic (e.g. "Not sent", "All other values"). */
  muted?: boolean;
  count: number;
  share: number;
}

/** The key of the remainder row (never a real value: real keys are ingested text or ''). */
export const REMAINDER_KEY = '\u0000remainder';
export const REMAINDER_LABEL = 'All other values';

/** 0.3 → "30%", 0.004 → "<1%", 0 → "0%" (whole percents; the count gives the precision). */
export function formatShare(share: number): string {
  if (!Number.isFinite(share) || share <= 0) return '0%';
  if (share < SMALL_SHARE) return '<1%';
  return `${Math.round(share * PERCENT)}%`;
}

/** The label of a bar, ALWAYS with its unit: (0.3, "page views") → "30% of page views". */
export function shareLabel(share: number, unit: string): string {
  return `${formatShare(share)} of ${unit}`;
}

/**
 * The bar's width in percent of the track: the share of the WHOLE total (not of the biggest
 * row), so a bar reads like its label. Clamped to 0..100; a non-zero share stays visible.
 */
export function barWidthPct(share: number): number {
  if (!Number.isFinite(share) || share <= 0) return 0;
  return Math.min(PERCENT, Math.max(MIN_VISIBLE_WIDTH_PCT, share * PERCENT));
}

/**
 * The listed rows plus one "All other values" row for what the top-N list leaves out, so the
 * bars add up to the whole total. Unchanged when nothing is left out (or there is no total).
 */
export function withRemainder(
  rows: readonly ProportionRow[],
  total: number,
): readonly ProportionRow[] {
  const listed = rows.reduce((sum, row) => sum + row.count, 0);
  const rest = total - listed;
  if (total <= 0 || rest <= 0) return rows;
  return [
    ...rows,
    { key: REMAINDER_KEY, label: REMAINDER_LABEL, muted: true, count: rest, share: rest / total },
  ];
}
