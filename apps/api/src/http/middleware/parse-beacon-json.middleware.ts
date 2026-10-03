/**
 * Step 2 of the browser body (after beacon-body.middleware.ts): the text body → a JSON value in
 * req.body. Malformed JSON → 400 INVALID_ENVELOPE (the body is NEVER echoed or logged). An empty
 * body becomes undefined, so the envelope validation answers 400 INVALID_ENVELOPE.
 */
import { ERROR_CODES } from '@nexus/shared';
import type { RequestHandler } from 'express';

import { BadRequestError } from '../../errors/app-error';

/** WHY separate from reading: one job each — size/media type there, syntax here. */
export function parseBeaconJsonMiddleware(): RequestHandler {
  return (req, _res, next) => {
    const text: unknown = req.body;
    if (typeof text !== 'string' || text.trim() === '') {
      req.body = undefined;
      next();
      return;
    }
    try {
      req.body = JSON.parse(text) as unknown;
    } catch {
      throw new BadRequestError('Malformed JSON body', ERROR_CODES.INVALID_ENVELOPE);
    }
    next();
  };
}
