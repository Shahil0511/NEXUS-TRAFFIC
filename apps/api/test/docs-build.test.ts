/**
 * The public integration guide renders cleanly: every chapter of docs/integration/ goes through
 * scripts/build-docs.ts with no leftover `{{PLACEHOLDER}}`, a title, and absolute links only.
 *
 * WHY: the guide is the link other teams read; a typo'd token or a relative link would ship to
 * them. This test renders in memory — it NEVER calls the script's main(), which wipes docs/dist.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  AGGREGATE_RETENTION_DAYS,
  COVERAGE_TARGET_RATIO,
  ENVIRONMENT_VALUES,
  PII_KIND_VALUES,
  ROUTES,
  SDK_DEFAULTS,
  SDK_KILL_ERROR_CODES,
  VISIBLE_DELTA_CREDIT_CAP_MS,
} from '@nexus/shared';
import { beforeAll, describe, expect, it } from 'vitest';

interface Chapter {
  id: string;
  title: string;
  html: string;
}

/** The exports of scripts/build-docs.ts this test relies on. */
interface BuildDocsScript {
  DOCS_URL: string;
  TOKENS: Readonly<Record<string, string>>;
  renderChapter: (fileName: string, markdown: string) => Chapter;
  renderPage: (chapters: Chapter[], builtAt: Date) => string;
}

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'build-docs.ts');
const CHAPTERS_DIR = path.join(REPO_ROOT, 'docs', 'integration');

const PLACEHOLDER = /\{\{[^}]*\}\}/;

let script: BuildDocsScript;
let chapters: Chapter[];

beforeAll(async () => {
  // Loaded by URL so the api tsconfig (rootDir apps/api) does not pull scripts/ into its program.
  script = (await import(pathToFileURL(SCRIPT).href)) as BuildDocsScript;
  chapters = fs
    .readdirSync(CHAPTERS_DIR)
    .filter((file) => file.endsWith('.md'))
    .sort((a, b) => a.localeCompare(b, 'en'))
    .map((file) => script.renderChapter(file, fs.readFileSync(path.join(CHAPTERS_DIR, file), 'utf8')));
});

describe('docs:build rendering', () => {
  it('found the chapters', () => {
    expect(chapters.length).toBeGreaterThan(5);
  });

  it('leaves no {{PLACEHOLDER}} in any chapter', () => {
    for (const chapter of chapters) {
      expect(PLACEHOLDER.exec(chapter.html)?.[0], chapter.id).toBeUndefined();
    }
  });

  it('gives every chapter a real title (its first # heading)', () => {
    for (const chapter of chapters) {
      expect(chapter.title, chapter.id).not.toBe(chapter.id);
      expect(chapter.title.length, chapter.id).toBeGreaterThan(0);
    }
  });

  it('renders only absolute links (in-guide links live under DOCS_URL)', () => {
    for (const chapter of chapters) {
      for (const [, href] of chapter.html.matchAll(/href="([^"]*)"/g)) {
        expect(href, `${chapter.id}: ${href}`).toMatch(/^(https?:|mailto:)/);
        if (href!.includes('/api/docs')) expect(href!.startsWith(script.DOCS_URL), href).toBe(true);
      }
    }
  });

  it('the assembled page has no placeholder either', () => {
    const page = script.renderPage(chapters, new Date('2026-10-01T00:00:00.000Z'));
    expect(PLACEHOLDER.exec(page)?.[0]).toBeUndefined();
    expect(page).toContain(script.DOCS_URL);
  });

  it('every token has a non-empty value', () => {
    for (const [name, value] of Object.entries(script.TOKENS)) expect(value, name).not.toBe('');
  });

  it('derives the Phase A tokens from the shared contract (never hand-typed)', () => {
    const tokens = script.TOKENS;
    for (const value of ENVIRONMENT_VALUES)
      expect(tokens['ENVIRONMENT_VALUES']).toContain(`\`${value}\``);
    for (const kind of PII_KIND_VALUES) expect(tokens['PII_KINDS']).toContain(`\`${kind}\``);
    for (const code of SDK_KILL_ERROR_CODES)
      expect(tokens['SDK_KILL_CODES']).toContain(`\`${code}\``);
    expect(tokens['CONFIG_URL']!.endsWith(ROUTES.ingest.config.path)).toBe(true);
    expect(tokens['COVERAGE_TARGET']).toBe(String(Math.round(COVERAGE_TARGET_RATIO * 100)));
    expect(tokens['AGGREGATE_RETENTION_DAYS']).toBe(String(AGGREGATE_RETENTION_DAYS));
    expect(tokens['SDK_RETRY_MAX_REPLAYS']).toBe(String(SDK_DEFAULTS.browser.retryQueueMaxReplays));
    expect(tokens['BROWSER_TICK_SECONDS']).toBe(String(SDK_DEFAULTS.browser.flushIntervalMs / 1000));
    expect(tokens['VISIBLE_CREDIT_CAP_SECONDS']).toBe(String(VISIBLE_DELTA_CREDIT_CAP_MS / 1000));
  });

  it('names the SDK tarballs after the packages that sdk:pack builds', () => {
    for (const [token, dir] of [
      ['REACT_SDK_VERSION', 'react'],
      ['NODE_SDK_VERSION', 'node'],
      ['EXPRESS_SDK_VERSION', 'express'],
    ] as const) {
      const manifest = path.join(REPO_ROOT, 'packages', dir, 'package.json');
      const { version } = JSON.parse(fs.readFileSync(manifest, 'utf8')) as { version: string };
      expect(script.TOKENS[token], token).toBe(version);
    }
  });
});
