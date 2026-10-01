/**
 * zod validation at the route edge. Stores the PARSED value (defaults + coercions applied) in
 * res.locals.validated — never reassigns req.query (an Express 5 getter).
 */
import type { RequestHandler } from 'express';
import type { z } from 'zod';

import { ValidationError } from '../../errors/app-error';

type Part = 'body' | 'query' | 'params';

function issuesOf(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

function validate(part: Part, schema: z.ZodType): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      throw new ValidationError(`Invalid request ${part}`, issuesOf(result.error));
    }
    res.locals.validated = { ...res.locals.validated, [part]: result.data };
    next();
  };
}

export const validateBody = (schema: z.ZodType): RequestHandler => validate('body', schema);
export const validateQuery = (schema: z.ZodType): RequestHandler => validate('query', schema);
export const validateParams = (schema: z.ZodType): RequestHandler => validate('params', schema);
