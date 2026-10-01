/**
 * Typed reads of what middleware attached to the response locals.
 *
 * WHY: controllers get fully-typed, already-validated input (zod defaults/coercions applied) and
 * fail loudly if a route forgot its middleware — instead of silently reading raw req.query.
 * The `schema` argument is only used for typing (and documents which schema validated the value).
 */
import type { Response } from 'express';
import type { z } from 'zod';

import type { AuthenticatedKey, Viewer } from '../domain/viewer';

function missing(what: string): never {
  throw new Error(`request-accessors: ${what} not set — is the middleware registered on this route?`);
}

export function validBody<S extends z.ZodType>(res: Response, _schema: S): z.output<S> {
  const value = res.locals.validated?.body;
  return (value === undefined ? missing('validated body') : value) as z.output<S>;
}

export function validQuery<S extends z.ZodType>(res: Response, _schema: S): z.output<S> {
  const value = res.locals.validated?.query;
  return (value === undefined ? missing('validated query') : value) as z.output<S>;
}

export function validParams<S extends z.ZodType>(res: Response, _schema: S): z.output<S> {
  const value = res.locals.validated?.params;
  return (value === undefined ? missing('validated params') : value) as z.output<S>;
}

export function requireViewer(res: Response): Viewer {
  return res.locals.viewer ?? missing('viewer (ssoAuth)');
}

export function requireIngest(res: Response): AuthenticatedKey {
  return res.locals.ingest ?? missing('ingest key (serverKeyAuth / publishableKeyAuth)');
}
