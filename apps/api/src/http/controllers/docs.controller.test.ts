import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ERROR_CODES, ROUTES } from '@nexus/shared';
import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Logger } from '../../lib/logger';
import { errorHandlerMiddleware } from '../middleware/error-handler.middleware';
import {
  contentTypeFor,
  DOCS_CACHE_CONTROL,
  DOCS_CONTENT_SECURITY_POLICY,
  DocsController,
  toSafeRelativePath,
  trailingSlashLocation,
} from './docs.controller';

/** Mounts only the docs routes, exactly as routes/index.ts does, under /api. */
function buildDocsApp(docsDir: string): Express {
  const ctl = new DocsController(docsDir);
  const router = express.Router();
  router.get(ROUTES.docs.home.path, ctl.home);
  router.get(ROUTES.docs.openapi.path, ctl.openapi);
  router.get(ROUTES.docs.files.path, ctl.files);
  const app = express();
  app.use('/api', router);
  app.use(errorHandlerMiddleware(new Logger('error')));
  return app;
}

let root: string;
let docsDir: string;
let app: Express;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-docs-'));
  docsDir = path.join(root, 'dist');
  fs.mkdirSync(path.join(docsDir, 'files', 'snippets'), { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'index.html'), '<!doctype html><title>guide</title>');
  fs.writeFileSync(path.join(docsDir, 'openapi.json'), '{"openapi":"3.1.0"}');
  fs.writeFileSync(path.join(docsDir, 'files', 'snippets', 'curl.sh'), 'echo hi\n');
  fs.writeFileSync(path.join(docsDir, 'files', 'snippets', 'express-esm.ts'), 'export {};\n');
  fs.writeFileSync(path.join(docsDir, 'files', '.secret'), 'nope');
  fs.writeFileSync(path.join(root, 'outside.txt'), 'outside the docs dir');
  app = buildDocsApp(docsDir);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('DocsController.home', () => {
  it('308-redirects /docs to docs/ (relative, so the /traffic prefix survives) keeping the query', async () => {
    const res = await request(app).get('/api/docs?utm=mail');
    expect(res.status).toBe(308);
    expect(res.headers['location']).toBe('docs/?utm=mail');
  });

  it('serves index.html with the docs CSP and a short public cache', async () => {
    const res = await request(app).get('/api/docs/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<title>guide</title>');
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['content-security-policy']).toBe(DOCS_CONTENT_SECURITY_POLICY);
    expect(res.headers['cache-control']).toBe(DOCS_CACHE_CONTROL);
  });

  it('returns the 404 envelope when the docs were never built', async () => {
    const res = await request(buildDocsApp(path.join(root, 'missing'))).get('/api/docs/');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(ERROR_CODES.NOT_FOUND);
  });
});

describe('DocsController.openapi', () => {
  it('serves openapi.json as JSON', async () => {
    const res = await request(app).get('/api/docs/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ openapi: '3.1.0' });
  });

  it('404s when the docs were never built', async () => {
    const res = await request(buildDocsApp(path.join(root, 'missing'))).get(
      '/api/docs/openapi.json',
    );
    expect(res.status).toBe(404);
  });
});

describe('DocsController.files', () => {
  it('serves nested snippet files as text', async () => {
    const res = await request(app).get('/api/docs/files/snippets/curl.sh');
    expect(res.status).toBe(200);
    expect(res.text).toBe('echo hi\n');
    expect(res.headers['content-type']).toMatch(/text\/plain/);
  });

  it('never labels a .ts snippet as video (mime default)', async () => {
    const res = await request(app).get('/api/docs/files/snippets/express-esm.ts');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
  });

  it.each([
    '/api/docs/files/..%2Foutside.txt',
    '/api/docs/files/snippets/..%2F..%2F..%2Foutside.txt',
    '/api/docs/files/..%5Coutside.txt',
    '/api/docs/files/.secret',
    '/api/docs/files/snippets/nope.sh',
  ])('404s on traversal, dotfiles and missing files: %s', async (url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('outside the docs dir');
  });
});

describe('pure helpers', () => {
  it('trailingSlashLocation keeps the query string', () => {
    expect(trailingSlashLocation('/api/docs')).toBe('docs/');
    expect(trailingSlashLocation('/api/docs?a=1&b=2')).toBe('docs/?a=1&b=2');
  });

  it('toSafeRelativePath rejects traversal and empty paths', () => {
    expect(toSafeRelativePath(['snippets', 'curl.sh'])).toBe('snippets/curl.sh');
    expect(toSafeRelativePath(['a', '..', 'b'])).toBeNull();
    expect(toSafeRelativePath(['..\\b'])).toBeNull();
    expect(toSafeRelativePath([])).toBeNull();
    expect(toSafeRelativePath(undefined)).toBeNull();
  });

  it('contentTypeFor maps json/tgz and defaults to text', () => {
    expect(contentTypeFor('examples/server-batch.json')).toMatch(/application\/json/);
    expect(contentTypeFor('sdk/nexus-express-1.0.0.tgz')).toBe('application/gzip');
    expect(contentTypeFor('snippets/fastapi_nexus_asgi.py')).toMatch(/text\/plain/);
  });
});
