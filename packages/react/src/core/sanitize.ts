/**
 * Input hygiene for `trackTool()` / `trackEvent()` and auto-captured clicks.
 *
 * WHY: the collector rejects a whole event for one bad field. Cleaning here (drop invalid props,
 * clip labels, ignore bad names) means a sloppy call site loses a field, never the event — and
 * NEVER throws into the host app.
 */
import {
  INGEST_LIMITS,
  PROP_KEY_PATTERN,
  TOOL_ACTION_VALUES,
  TOOL_NAME_PATTERN,
  type ToolAction as SharedToolAction,
} from '@nexus/shared/constants';

import type { Props } from './wire';

/**
 * WHY a literal copy: the published .d.ts must not import @nexus/shared (not installed by
 * consumers). The two assertions below fail the typecheck if it ever drifts from the contract.
 */
export type ToolAction = 'click' | 'open' | 'submit' | 'export' | 'toggle' | 'search' | 'other';
const _toolActionMatches: SharedToolAction extends ToolAction ? true : never = true;
const _toolActionCovers: ToolAction extends SharedToolAction ? true : never = true;
void _toolActionMatches;
void _toolActionCovers;

export interface TrackOptions {
  /** One of `click`, `open`, `submit`, `export`, `toggle`, `search`, `other`. */
  action?: ToolAction;
  /** A STATIC UI label such as "Export CSV" — NEVER text the user typed. ≤ 120 chars. */
  label?: string;
  /** A number that matters for the tool, e.g. rows exported. */
  value?: number;
  /** ≤ 10 entries; keys `^[a-z][a-z0-9_]{0,39}$`; strings ≤ 128 chars, numbers, booleans. */
  props?: Record<string, unknown>;
}

export interface CleanTrackFields {
  action?: ToolAction;
  label?: string;
  value?: number;
  props?: Props;
}

/** WHY: `tool` and `custom.name` share one identifier rule. */
export function isValidName(name: unknown): name is string {
  return typeof name === 'string' && TOOL_NAME_PATTERN.test(name);
}

/** WHY: an unknown action is dropped (the event still counts as a plain use). */
export function cleanAction(action: unknown): ToolAction | undefined {
  return (TOOL_ACTION_VALUES as readonly unknown[]).includes(action)
    ? (action as ToolAction)
    : undefined;
}

/** WHY: labels are clipped, not rejected; blank labels are omitted. */
export function cleanLabel(label: unknown): string | undefined {
  if (typeof label !== 'string') return undefined;
  const trimmed = label.trim();
  return trimmed ? trimmed.slice(0, INGEST_LIMITS.maxLabelLength) : undefined;
}

/** WHY: NaN / Infinity are not valid JSON numbers and are rejected by the collector. */
export function cleanValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** WHY: keeps the first 10 valid entries; drops nested objects, bad keys and non-finite numbers. */
export function cleanProps(props: unknown): Props | undefined {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return undefined;
  const out: Props = {};
  let count = 0;
  for (const [key, raw] of Object.entries(props as Record<string, unknown>)) {
    if (count >= INGEST_LIMITS.maxPropsKeys) break;
    if (!PROP_KEY_PATTERN.test(key)) continue;
    const value = cleanPropValue(raw);
    if (value === undefined) continue;
    out[key] = value;
    count++;
  }
  return count > 0 ? out : undefined;
}

function cleanPropValue(raw: unknown): string | number | boolean | undefined {
  if (typeof raw === 'string') return raw.slice(0, INGEST_LIMITS.maxPropStringLength);
  if (typeof raw === 'boolean') return raw;
  return cleanValue(raw);
}

/** WHY: one call turns caller options into contract-valid optional fields (undefined omitted). */
export function cleanTrackOptions(options: TrackOptions | undefined): CleanTrackFields {
  const out: CleanTrackFields = {};
  if (!options) return out;
  const action = cleanAction(options.action);
  const label = cleanLabel(options.label);
  const value = cleanValue(options.value);
  const props = cleanProps(options.props);
  if (action) out.action = action;
  if (label) out.label = label;
  if (value !== undefined) out.value = value;
  if (props) out.props = props;
  return out;
}

/** WHY: the envelope's `user.email` is a hint; keep it trimmed, lower-case and within limits. */
export function cleanEmail(email: unknown): string | undefined {
  if (typeof email !== 'string') return undefined;
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || trimmed.length > INGEST_LIMITS.maxEmailLength) return undefined;
  return trimmed;
}
