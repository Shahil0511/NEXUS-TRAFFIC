/**
 * ROUTES.docs.* — the PUBLIC integration guide (the link sent to other teams), the OpenAPI file and
 * downloadable snippets/examples/SDK tarballs, served from the built docs directory (docs/dist).
 * The guide page gets its own CSP (it is HTML, unlike the rest of the API).
 */
import type { RequestHandler } from 'express';

import { notImplemented } from '../../lib/not-implemented';

export class DocsController {
  constructor(private readonly docsDir: string) {}

  /** GET /docs/ — redirects /docs → /docs/ (308) so relative links resolve. */
  home: RequestHandler = (_req, _res) => {
    void this.docsDir;
    throw notImplemented('DocsController.home');
  };

  openapi: RequestHandler = (_req, _res) => {
    throw notImplemented('DocsController.openapi');
  };

  /** GET /docs/files/*filePath — path-traversal safe (sendFile with root, dotfiles denied). */
  files: RequestHandler = (_req, _res) => {
    throw notImplemented('DocsController.files');
  };
}
