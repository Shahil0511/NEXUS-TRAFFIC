/**
 * Per-route JSON body parsers (no global body parser — each route sets its own size limit).
 * - dashboard: small bodies, generic errors.
 * - server ingest: 512 KiB, `application/json` only (415 otherwise), malformed JSON → INVALID_ENVELOPE.
 *   The media type is read from the Content-Type HEADER, not via req.is(): req.is() returns null
 *   for a request WITHOUT a body, which turned an empty `application/json` POST into a misleading
 *   415. An empty body now passes through unparsed (req.body undefined) and the envelope validation
 *   answers 400 INVALID_ENVELOPE.
 */
import { ERROR_CODES, INGEST_LIMITS } from '@nexus/shared';
import express, { type RequestHandler } from 'express';

import { BadRequestError, UnsupportedMediaTypeError } from '../../errors/app-error';

export function dashboardJsonBody(): RequestHandler {
  return express.json({ limit: '100kb' });
}

const JSON_MEDIA_TYPE = 'application/json';

/** `application/json; charset=utf-8` → `application/json` ('' when the header is missing). */
export function mediaTypeOf(contentType: string | undefined): string {
  return (contentType ?? '').split(';')[0]!.trim().toLowerCase();
}

export function serverIngestJsonBody(): RequestHandler {
  const parse = express.json({ limit: INGEST_LIMITS.server.maxBodyBytes, type: JSON_MEDIA_TYPE });
  return (req, res, next) => {
    if (mediaTypeOf(req.headers['content-type']) !== JSON_MEDIA_TYPE) {
      throw new UnsupportedMediaTypeError('Content-Type must be application/json');
    }
    parse(req, res, (err?: unknown) => {
      if ((err as { type?: string } | undefined)?.type === 'entity.parse.failed') {
        next(new BadRequestError('Malformed JSON body', ERROR_CODES.INVALID_ENVELOPE));
        return;
      }
      next(err);
    });
  };
}
