/**
 * Raw body reader of POST ROUTES.ingest.browser (step 1 of 2; parse-beacon-json.middleware.ts is
 * step 2). `navigator.sendBeacon(url, string)` always sends `text/plain;charset=UTF-8` — a
 * CORS-safelisted type, so the beacon needs no preflight — and the keepalive-fetch fallback may
 * send `application/json`. Both are read as TEXT, up to INGEST_LIMITS.browser.maxBodyBytes (60 KiB,
 * 413 PAYLOAD_TOO_LARGE above). Any other Content-Type → 415. An empty body passes through
 * (req.body undefined/'') and the envelope validation answers 400 INVALID_ENVELOPE.
 */
import { INGEST_LIMITS } from '@nexus/shared';
import express, { type RequestHandler } from 'express';

import { UnsupportedMediaTypeError } from '../../errors/app-error';
import { mediaTypeOf } from './json-body.middleware';

/** The ONLY media types a browser beacon may use. */
export const BEACON_MEDIA_TYPES = ['text/plain', 'application/json'] as const;

/** WHY: the browser endpoint must accept sendBeacon's text/plain, which express.json() ignores. */
export function beaconBodyMiddleware(): RequestHandler {
  const read = express.text({ limit: INGEST_LIMITS.browser.maxBodyBytes, type: [...BEACON_MEDIA_TYPES] });
  return (req, res, next) => {
    const mediaType = mediaTypeOf(req.headers['content-type']);
    if (!(BEACON_MEDIA_TYPES as readonly string[]).includes(mediaType)) {
      throw new UnsupportedMediaTypeError('Content-Type must be text/plain or application/json');
    }
    read(req, res, next);
  };
}
