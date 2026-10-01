/**
 * Per-route JSON body parsers (no global body parser — each route sets its own size limit).
 * - dashboard: small bodies, generic errors.
 * - server ingest: 512 KiB, `application/json` only (415 otherwise), malformed JSON → INVALID_ENVELOPE.
 */
import { ERROR_CODES, INGEST_LIMITS } from '@nexus/shared';
import express, { type RequestHandler } from 'express';

import { BadRequestError, UnsupportedMediaTypeError } from '../../errors/app-error';

export function dashboardJsonBody(): RequestHandler {
  return express.json({ limit: '100kb' });
}

export function serverIngestJsonBody(): RequestHandler {
  const parse = express.json({ limit: INGEST_LIMITS.server.maxBodyBytes, type: 'application/json' });
  return (req, res, next) => {
    if (!req.is('application/json')) throw new UnsupportedMediaTypeError('Content-Type must be application/json');
    parse(req, res, (err?: unknown) => {
      if ((err as { type?: string } | undefined)?.type === 'entity.parse.failed') {
        next(new BadRequestError('Malformed JSON body', ERROR_CODES.INVALID_ENVELOPE));
        return;
      }
      next(err);
    });
  };
}
