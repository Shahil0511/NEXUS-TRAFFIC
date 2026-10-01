/**
 * ROUTES.docs.* — the PUBLIC integration guide (the link sent to other teams), the OpenAPI file and
 * downloadable snippets/examples/SDK tarballs, served from the built docs directory (docs/dist,
 * produced by `npm run docs:build` → scripts/build-docs.ts).
 * The guide page gets its own CSP (it is HTML, unlike the rest of the API, which helmet locks down
 * to `default-src 'none'`).
 */
import path from 'node:path';

import type { NextFunction, RequestHandler, Response } from 'express';

import { NotFoundError } from '../../errors/app-error';

/** CSP of the guide page: inline CSS only, no scripts, no external assets, never framed. */
export const DOCS_CONTENT_SECURITY_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; " +
  "base-uri 'none'; frame-ancestors 'none'";

/** The guide changes only on deploy; five minutes keeps gateway/browser caches short-lived. */
export const DOCS_CACHE_CONTROL = 'public, max-age=300';

const INDEX_FILE = 'index.html';
const OPENAPI_FILE = 'openapi.json';
const FILES_DIR = 'files';

/** Explicit types so `.ts`/`.py`/`.sh` snippets are shown as text (mime would call `.ts` video). */
const FILE_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.json': 'application/json; charset=utf-8',
  '.tgz': 'application/gzip',
};
const TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8';

/** Errors from `send` that mean "no such file" (missing, a directory, or a denied dotfile). */
const MISSING_FILE_CODES = new Set(['ENOENT', 'ENOTDIR', 'EISDIR']);

interface SendError {
  code?: string;
  status?: number;
  statusCode?: number;
}

/** WHY: `/docs` must become `/docs/` so the browser treats the guide as a directory. */
export function needsTrailingSlash(originalUrl: string): boolean {
  const pathname = originalUrl.split('?')[0] ?? '';
  return !pathname.endsWith('/');
}

/**
 * WHY: the redirect must survive the gateway prefix (`/traffic` is stripped by nginx), so the
 * Location is RELATIVE: `docs/` resolved against `…/traffic/api/docs` gives `…/traffic/api/docs/`.
 */
export function trailingSlashLocation(originalUrl: string): string {
  const queryStart = originalUrl.indexOf('?');
  const pathname = queryStart === -1 ? originalUrl : originalUrl.slice(0, queryStart);
  const query = queryStart === -1 ? '' : originalUrl.slice(queryStart);
  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1);
  return `${lastSegment}/${query}`;
}

/**
 * WHY: Express 5 hands a named wildcard over as `string[]` (already URI-decoded). A decoded segment
 * may still contain `/`, `\` or `..`, so we split again and refuse any traversal attempt.
 * Returns the safe relative path, or null when the request must be a 404.
 */
export function toSafeRelativePath(raw: unknown): string | null {
  const parts = (Array.isArray(raw) ? raw : [raw]).filter(
    (p): p is string => typeof p === 'string',
  );
  const segments = parts.flatMap((part) => part.split(/[\\/]+/)).filter((s) => s.length > 0);
  if (segments.length === 0) return null;
  if (segments.some((s) => s === '..' || s === '.' || s.includes('\0'))) return null;
  return segments.join('/');
}

/** WHY: snippets must open as readable text in a browser tab, never be sniffed as media. */
export function contentTypeFor(fileName: string): string {
  return FILE_CONTENT_TYPES[path.extname(fileName).toLowerCase()] ?? TEXT_CONTENT_TYPE;
}

/** WHY: "docs not built" and "no such file" are both a plain 404 for the caller. */
function isMissingFile(err: SendError): boolean {
  const status = err.status ?? err.statusCode;
  return (
    (err.code !== undefined && MISSING_FILE_CODES.has(err.code)) || status === 404 || status === 403
  );
}

/** WHY: one callback for every sendFile — map missing files to NotFoundError, pass others on. */
function onSendDone(res: Response, next: NextFunction, what: string) {
  return (err?: unknown): void => {
    if (!err || res.headersSent) return;
    next(isMissingFile(err as SendError) ? new NotFoundError(`${what} not found`) : err);
  };
}

/** Serves the built guide (`docsDir` = config.docsDir, normally /app/docs/dist). */
export class DocsController {
  constructor(private readonly docsDir: string) {}

  /** GET /docs/ — redirects /docs → /docs/ (308) so relative links resolve. */
  home: RequestHandler = (req, res, next) => {
    if (needsTrailingSlash(req.originalUrl)) {
      res.redirect(308, trailingSlashLocation(req.originalUrl));
      return;
    }
    res.setHeader('Content-Security-Policy', DOCS_CONTENT_SECURITY_POLICY);
    res.sendFile(
      INDEX_FILE,
      { root: this.docsDir, cacheControl: false, headers: { 'Cache-Control': DOCS_CACHE_CONTROL } },
      onSendDone(res, next, 'Integration guide (docs are not built)'),
    );
  };

  /** GET /docs/openapi.json — the machine-readable ingest contract. */
  openapi: RequestHandler = (_req, res, next) => {
    res.type('application/json');
    res.sendFile(
      OPENAPI_FILE,
      { root: this.docsDir, cacheControl: false, headers: { 'Cache-Control': DOCS_CACHE_CONTROL } },
      onSendDone(res, next, 'OpenAPI document'),
    );
  };

  /** GET /docs/files/*filePath — path-traversal safe (sendFile with root, dotfiles denied). */
  files: RequestHandler = (req, res, next) => {
    const relative = toSafeRelativePath(req.params['filePath']);
    if (relative === null) throw new NotFoundError('File not found');
    res.setHeader('Content-Type', contentTypeFor(relative));
    res.sendFile(
      relative,
      {
        root: path.join(this.docsDir, FILES_DIR),
        dotfiles: 'deny',
        cacheControl: false,
        headers: { 'Cache-Control': DOCS_CACHE_CONTROL },
      },
      onSendDone(res, next, 'File'),
    );
  };
}
