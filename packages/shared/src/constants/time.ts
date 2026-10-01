/**
 * Time, ranges and deployment path constants.
 *
 * WHY: the dashboard, the API time-window resolver and the SQL bucket expressions must agree on
 * the reporting timezone and range presets. REPORTING_TIME_ZONE is a constant (not env) on purpose:
 * changing it later would misalign every historical chart.
 */

/** Public URL prefix on nexus.libas.in. nginx strips it for /traffic/api and /traffic/socket.io. */
export const PUBLIC_BASE_PATH = '/traffic';

export const REPORTING_TIME_ZONE = 'Asia/Kolkata';
/** Fixed offset of REPORTING_TIME_ZONE (India has no DST) — used as the date_bin origin. */
export const REPORTING_UTC_OFFSET = '+05:30';

export const RANGE_VALUES = ['15m', '1h', '6h', '24h', '7d', '30d', '90d', 'custom'] as const;
export type RangePreset = (typeof RANGE_VALUES)[number];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const RANGE_DURATIONS_MS = {
  '15m': 15 * MINUTE,
  '1h': HOUR,
  '6h': 6 * HOUR,
  '24h': DAY,
  '7d': 7 * DAY,
  '30d': 30 * DAY,
  '90d': 90 * DAY,
} as const satisfies Record<Exclude<RangePreset, 'custom'>, number>;

export const DEFAULT_RANGE: RangePreset = '24h';

export const GRAIN_VALUES = ['minute', 'hour', 'day'] as const;
export type Grain = (typeof GRAIN_VALUES)[number];

/** Bucket size per range: ranges up to 6h use minutes, up to 14d hours, beyond that days. */
export const GRAIN_RULES: ReadonlyArray<{ maxRangeMs: number; grain: Grain }> = [
  { maxRangeMs: 6 * HOUR, grain: 'minute' },
  { maxRangeMs: 14 * DAY, grain: 'hour' },
  { maxRangeMs: Number.POSITIVE_INFINITY, grain: 'day' },
];

export const GRAIN_MS = { minute: MINUTE, hour: HOUR, day: DAY } as const satisfies Record<
  Grain,
  number
>;

/** Raw-table query caps (v1 has no rollups): percentiles are expensive, counts less so. */
export const MAX_PERCENTILE_RANGE_MS = 31 * DAY;
export const MAX_COUNT_RANGE_MS = 93 * DAY;
