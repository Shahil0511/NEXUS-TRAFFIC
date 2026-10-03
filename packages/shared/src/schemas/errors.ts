/**
 * zod mirror of `ApiErrorBody` (../errors.ts stays zod-free for the SDKs).
 *
 * WHY: the OpenAPI document (scripts/emit-openapi.ts) and tests describe the error envelope from ONE
 * schema; the `z.ZodType<ApiErrorBody>` annotation breaks the build if it drifts from the interface.
 */
import { z } from 'zod';

import { ERROR_CODES, type ApiErrorBody, type ErrorCode } from '../errors';

const ERROR_CODE_VALUES = Object.values(ERROR_CODES) as [ErrorCode, ...ErrorCode[]];

/** `{ error: { code, message, details?, requestId? } }` — every non-2xx JSON response. */
export const apiErrorBodySchema: z.ZodType<ApiErrorBody> = z.object({
  error: z.object({
    code: z.enum(ERROR_CODE_VALUES),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
