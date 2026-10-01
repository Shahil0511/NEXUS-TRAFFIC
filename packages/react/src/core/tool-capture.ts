/**
 * WHY: the auto-capture convention of the browser contract. Teams mark the elements they care
 * about and every click is recorded without a line of tracking code:
 *
 *   <button data-nexus-tool="audits.export-csv" data-nexus-action="export"
 *           data-nexus-label="Export CSV">Export CSV</button>
 *
 * ONLY the data attributes are read — NEVER the element's text (it may contain user data).
 * An element whose tool name does not match TOOL_NAME_PATTERN is ignored.
 */
import { cleanAction, cleanLabel, isValidName, type CleanTrackFields } from './sanitize';

export const TOOL_ATTRIBUTES = {
  tool: 'data-nexus-tool',
  action: 'data-nexus-action',
  label: 'data-nexus-label',
} as const;

export interface CapturedTool extends CleanTrackFields {
  tool: string;
}

/** WHY: pure mapping from a click target to a tool use (or nothing). NEVER throws. */
export function toolFromClickTarget(target: EventTarget | null): CapturedTool | undefined {
  try {
    const element = asElement(target)?.closest(`[${TOOL_ATTRIBUTES.tool}]`);
    if (!element) return undefined;
    const tool = element.getAttribute(TOOL_ATTRIBUTES.tool)?.trim();
    if (!isValidName(tool)) return undefined;
    const action = cleanAction(element.getAttribute(TOOL_ATTRIBUTES.action)?.trim()) ?? 'click';
    const label = cleanLabel(element.getAttribute(TOOL_ATTRIBUTES.label));
    return { tool, action, ...(label ? { label } : {}) };
  } catch {
    return undefined;
  }
}

/** WHY: a click on the text inside a button targets a Text node, which has no `closest`. */
function asElement(target: EventTarget | null): Element | null {
  if (!target || typeof Element === 'undefined') return null;
  if (target instanceof Element) return target;
  const parent = (target as Node).parentElement;
  return parent ?? null;
}
