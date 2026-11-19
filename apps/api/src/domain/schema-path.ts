/**
 * The `schema_path` of a rejection row in `traffic.ingest_rejections` (A9). Pure, no I/O.
 *
 * WHY normalised: a zod issue path may contain sender-chosen text (a prop KEY, an unknown field) and
 * array indexes. Only the SHAPE is stored — `events.*.props.*`-style paths with fixed names — so a
 * sender can neither leak data into the table nor create unbounded rows. The zod MESSAGE is NEVER
 * stored. Output always satisfies `ingest_rejections_schema_path_check` (`^[A-Za-z0-9_.*]*$`, ≤ 128).
 */
import { ERROR_CODES, INGEST_LIMITS, type IngestRejectionCode } from '@nexus/shared';

/** The "no path" value (the column default): envelope-level refusals and unknown constraints. */
export const NO_SCHEMA_PATH = '';

const WILDCARD = '*';
const SEPARATOR = '.';
const PROPS_SEGMENT = 'props';
const FIELD_SEGMENT = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
const CONSTRAINT_NAME = /^[A-Za-z0-9_]+$/;

/**
 * Fixed schema paths of the per-event reject codes that are not zod issues.
 * DB_CONSTRAINT uses the violated constraint's name instead (schemaPathOfConstraint).
 */
export const FIXED_SCHEMA_PATHS: Readonly<Partial<Record<IngestRejectionCode, string>>> = {
  [ERROR_CODES.EVENT_TIME_OUT_OF_RANGE]: 'occurredAt',
  [ERROR_CODES.PATH_OUTSIDE_APP]: 'path',
};

function cut(path: string): string {
  return path.slice(0, INGEST_LIMITS.maxSchemaPathLength);
}

/**
 * WHY: numbers → `*`; the key after a `props` segment → `*`; any segment that is not a plain field
 * name → `*`; joined with `.` and cut at INGEST_LIMITS.maxSchemaPathLength.
 */
export function normalizeSchemaPath(path: readonly PropertyKey[]): string {
  const segments = path.map((segment, i) => {
    if (typeof segment !== 'string') return WILDCARD;
    if (i > 0 && path[i - 1] === PROPS_SEGMENT) return WILDCARD;
    return FIELD_SEGMENT.test(segment) ? segment : WILDCARD;
  });
  return cut(segments.join(SEPARATOR));
}

/** WHY: a poison row's pg constraint name is a fixed identifier — safe to store; anything else is ''. */
export function schemaPathOfConstraint(constraint: string | undefined): string {
  if (!constraint || !CONSTRAINT_NAME.test(constraint)) return NO_SCHEMA_PATH;
  return cut(constraint);
}
