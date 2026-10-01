/**
 * Display formatting for the dashboard — dates in IST, durations, counts, percentages.
 *
 * WHY: every timestamp from the API is UTC ISO-8601; the business reads India time
 * (REPORTING_TIME_ZONE, the same zone the SQL buckets use), whatever the viewer's laptop says.
 * One module keeps every table, tooltip and KPI consistent. All helpers accept null and render
 * an em dash, because "no data" must look different from 0.
 */
import { REPORTING_TIME_ZONE, REPORTING_UTC_OFFSET, type Grain } from '@nexus/shared';

export const EMPTY_VALUE = '—';
const LOCALE = 'en-IN';
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;

const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, {
  timeZone: REPORTING_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const bucketFormats: Record<Grain, Intl.DateTimeFormat> = {
  minute: new Intl.DateTimeFormat(LOCALE, {
    timeZone: REPORTING_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }),
  hour: new Intl.DateTimeFormat(LOCALE, {
    timeZone: REPORTING_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }),
  day: new Intl.DateTimeFormat(LOCALE, {
    timeZone: REPORTING_TIME_ZONE,
    day: 'numeric',
    month: 'short',
  }),
};

const isoPartsFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: REPORTING_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const compactFormat = new Intl.NumberFormat(LOCALE, {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const integerFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

/** "1 Oct, 14:05:09" in IST. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return EMPTY_VALUE;
  return dateTimeFormat.format(new Date(iso));
}

/** Chart axis/tooltip label for a bucket start, sized to the grain. */
export function formatBucket(iso: string, grain: Grain): string {
  return bucketFormats[grain].format(new Date(iso));
}

/** 840 → "840 ms", 1234 → "1.23 s", 125000 → "2m 5s". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return EMPTY_VALUE;
  if (ms < MS_PER_SECOND) return `${Math.round(ms)} ms`;
  if (ms < MS_PER_MINUTE) return `${(ms / MS_PER_SECOND).toFixed(2)} s`;
  const minutes = Math.floor(ms / MS_PER_MINUTE);
  const seconds = Math.round((ms % MS_PER_MINUTE) / MS_PER_SECOND);
  return `${minutes}m ${seconds}s`;
}

/** 1234 → "1.2K", 1234567 → "12.3L", 123456789 → "12.3Cr" (Indian compact units). */
export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
  return compactFormat.format(value);
}

/** 1234567 → "12,34,567" (Indian digit grouping). */
export function formatInteger(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
  return integerFormat.format(value);
}

/** 3.456 → "3.5%" (input is already 0..100). */
export function formatPercent(value: number | null | undefined, fractionDigits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
  return `${value.toFixed(fractionDigits)}%`;
}

/** KPI delta label: 12.34 → "+12.3%", -4 → "−4.0%", null → "—". */
export function formatDeltaPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(1)}%`;
}

/** ISO instant → the IST value of an <input type="datetime-local"> ("2026-10-01T14:05"). */
export function toIstInputValue(iso: string): string {
  const parts = Object.fromEntries(
    isoPartsFormat.formatToParts(new Date(iso)).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** <input type="datetime-local"> value read as IST → ISO with offset ("…T14:05:00+05:30"). */
export function fromIstInputValue(value: string): string {
  return `${value}:00${REPORTING_UTC_OFFSET}`;
}

const windowBoundFormat = new Intl.DateTimeFormat(LOCALE, {
  timeZone: REPORTING_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** How a chart bucket is described in captions. */
export const GRAIN_LABELS: Record<Grain, string> = {
  minute: 'per-minute',
  hour: 'hourly',
  day: 'daily',
};

/** "30 Sept, 13:30 – 1 Oct, 13:30 IST · hourly buckets" — the window a response covers. */
export function formatWindowCaption(window: { from: string; to: string; grain: Grain }): string {
  const from = windowBoundFormat.format(new Date(window.from));
  const to = windowBoundFormat.format(new Date(window.to));
  return `${from} – ${to} IST · ${GRAIN_LABELS[window.grain]} buckets`;
}
