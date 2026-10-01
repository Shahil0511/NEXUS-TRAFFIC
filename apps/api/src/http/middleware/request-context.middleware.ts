/**
 * Assigns a request id (accepts a sane inbound X-Request-ID, else generates one), echoes it in the
 * response header, and runs the rest of the request inside the AsyncLocalStorage context so every
 * log line carries it.
 */
import { randomUUID } from 'node:crypto';

import { INGEST_HEADERS } from '@nexus/shared';
import type { RequestHandler } from 'express';

import { requestContext } from '../../context/request-context';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function requestContextMiddleware(): RequestHandler {
  return (req, res, next) => {
    const inbound = req.get(INGEST_HEADERS.requestId);
    const requestId = inbound && SAFE_REQUEST_ID.test(inbound) ? inbound : randomUUID();
    res.locals.requestId = requestId;
    res.setHeader(INGEST_HEADERS.requestId, requestId);
    requestContext.run({ requestId }, () => next());
  };
}
