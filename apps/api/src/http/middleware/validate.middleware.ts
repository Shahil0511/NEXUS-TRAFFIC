/**
 * zod validation at the route edge. Stores the PARSED value (defaults + coercions applied) in
 * res.locals.validated — never reassigns req.query (an Express 5 getter).
 */
import type { ErrorCode } from '@nexus/shared';
import type { RequestHandler } from 'express';
import type { z } from 'zod';

import { ValidationError } from '../../errors/app-error';

type Part = 'body' | 'query' | 'params';

function issuesOf(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

function validate(part: Part, schema: z.ZodType, code?: ErrorCode): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      throw new ValidationError(`Invalid request ${part}`, issuesOf(result.error), code);
    }
    res.locals.validated = { ...res.locals.validated, [part]: result.data };
    next();
  };
}

/** `code` overrides VALIDATION_ERROR (the ingest envelope answers INVALID_ENVELOPE, see the public guide). */
export const validateBody = (schema: z.ZodType, code?: ErrorCode): RequestHandler => validate('body', schema, code);
export const validateQuery = (schema: z.ZodType): RequestHandler => validate('query', schema);
export const validateParams = (schema: z.ZodType): RequestHandler => validate('params', schema);
