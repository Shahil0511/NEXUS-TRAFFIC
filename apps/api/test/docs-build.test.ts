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
});
