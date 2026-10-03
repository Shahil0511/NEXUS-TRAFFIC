/**
 * Build the PUBLIC integration guide → docs/dist (served at https://nexus.libas.in/traffic/api/docs/).
 *
 * WHY: the guide is the deliverable other teams read. It is written as plain Markdown chapters in
 * docs/integration/ (easy to review in a diff) and rendered into ONE self-contained HTML page —
 * inline CSS, no scripts, no external assets — so the strict docs CSP of DocsController holds.
 *
 * Output (docs/dist, git-ignored, copied into the api image):
 *   index.html                      every chapter in filename order, left nav, light/dark
 *   openapi.json                    scripts/emit-openapi.ts
 *   files/snippets/*                docs/snippets/* (downloadable reference code)
 *   files/examples/*.json           SERVER_BATCH_EXAMPLE / BROWSER_BATCH_EXAMPLE
 *
 * Markdown conventions understood here:
 *   {{TOKEN}}                       replaced from TOKENS below (an unknown token FAILS the build)
 *   {{snippet:curl.sh}}             inlines docs/snippets/curl.sh as a fenced code block
 *   {{example:server}}              inlines SERVER_BATCH_EXAMPLE (or :browser) as a JSON block
 *   [text](02-server-contract.md)   chapter links → absolute `…/api/docs/#02-server-contract`
 *   [text](files/snippets/curl.sh)  relative links → absolute `…/api/docs/files/snippets/curl.sh`
 *
 * Run from the repo root: `npm run docs:build` (tsx --conditions=@nexus/source). Works the same in
 * the api Docker build stage.
 *
 * @see ./emit-openapi.ts
 * @see ../apps/api/src/http/controllers/docs.controller.ts  serves the output
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  BROWSER_BATCH_EXAMPLE,
  EVENT_CLOCK_POLICY,
  INGEST_CONTRACT_VERSION,
  INGEST_LIMITS,
  PUBLIC_BASE_PATH,
  ROUTES,
  SDK_DEFAULTS,
  SERVER_BATCH_EXAMPLE,
} from '@nexus/shared';
import { Marked, type Tokens } from 'marked';

import { apiEnvSchema } from '../apps/api/src/config/env.schema';
import {
  buildOpenApiDocument,
  DIST_OPENAPI_PATH,
  serializeOpenApi,
  writeOpenApi,
} from './emit-openapi';

// ─── Paths ──────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..');
const CHAPTERS_DIR = path.join(REPO_ROOT, 'docs', 'integration');
const SNIPPETS_DIR = path.join(REPO_ROOT, 'docs', 'snippets');
const DIST_DIR = path.join(REPO_ROOT, 'docs', 'dist');
const DIST_FILES_DIR = path.join(DIST_DIR, 'files');

// ─── Public URLs and substitution tokens ────────────────────────────────────

/** Defaults come from the api env schema, so the guide and the server agree. */
const PUBLIC_ORIGIN =
  process.env['PUBLIC_ORIGIN'] ?? apiEnvSchema.shape.PUBLIC_ORIGIN.parse(undefined);
const DOCS_CONTACT =
  process.env['DOCS_CONTACT'] ?? apiEnvSchema.shape.DOCS_CONTACT.parse(undefined);

/** `https://nexus.libas.in/traffic` — what teams put in NEXUS_URL. */
export const PUBLIC_URL = `${PUBLIC_ORIGIN.replace(/\/+$/, '')}${PUBLIC_BASE_PATH}`;
/** `https://nexus.libas.in/traffic/api`. */
const API_URL = `${PUBLIC_URL}/api`;
/** `https://nexus.libas.in/traffic/api/docs/` — every link in the page is absolute from here. */
export const DOCS_URL = `${API_URL}${ROUTES.docs.home.path}`;

const KIB = 1024;

/** Every `{{TOKEN}}` the chapters may use. */
export const TOKENS: Readonly<Record<string, string>> = {
  DOCS_CONTACT,
  PUBLIC_URL,
  API_URL,
  DOCS_URL,
  CONTRACT_VERSION: String(INGEST_CONTRACT_VERSION),
  SERVER_URL: `${API_URL}${ROUTES.ingest.server.path}`,
  BROWSER_URL: `${API_URL}${ROUTES.ingest.browser.path}`,
  VERIFY_URL: `${API_URL}${ROUTES.ingest.verify.path}`,
  SERVER_MAX_EVENTS: String(INGEST_LIMITS.server.maxEvents),
  SERVER_MAX_BODY_KB: String(INGEST_LIMITS.server.maxBodyBytes / KIB),
  BROWSER_MAX_EVENTS: String(INGEST_LIMITS.browser.maxEvents),
  BROWSER_MAX_BODY_KB: String(INGEST_LIMITS.browser.maxBodyBytes / KIB),
  MAX_BACKDATE_DAYS: String(EVENT_CLOCK_POLICY.maxBackdateMs / 86_400_000),
  MAX_FUTURE_MINUTES: String(EVENT_CLOCK_POLICY.maxFutureMs / 60_000),
  RATE_SERVER_PER_MIN: String(apiEnvSchema.shape.INGEST_RATE_LIMIT_SERVER_PER_MIN.parse(undefined)),
  RATE_BROWSER_PER_MIN: String(
    apiEnvSchema.shape.INGEST_RATE_LIMIT_BROWSER_PER_SESSION_PER_MIN.parse(undefined),
  ),
  RATE_BROWSER_APP_PER_MIN: String(apiEnvSchema.shape.INGEST_RATE_LIMIT_BROWSER_PER_MIN.parse(undefined)),
  RATE_IP_FAILURES_PER_MIN: String(apiEnvSchema.shape.INGEST_IP_FAILURE_PER_MIN.parse(undefined)),
  FLUSH_EVENTS: String(SDK_DEFAULTS.server.flushEvents),
  FLUSH_SECONDS: String(SDK_DEFAULTS.server.flushIntervalMs / 1000),
};

const SNIPPET_LANGUAGES: Readonly<Record<string, string>> = {
  '.sh': 'bash',
  '.js': 'js',
  '.ts': 'ts',
  '.py': 'python',
  '.tsx': 'tsx',
  '.json': 'json',
};

// ─── Small pure helpers ─────────────────────────────────────────────────────

/** WHY: everything we inject into HTML attributes or text must be escaped. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Heading text → stable anchor slug. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z#0-9]+;/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `02-server-contract.md` → `02-server-contract`. */
function chapterIdOf(fileName: string): string {
  return path.basename(fileName, '.md');
}

/**
 * WHY absolute: the page is also reachable on localhost and through mirrors; links must always
 * point at the published guide. Chapter links become in-page anchors on the absolute URL.
 */
export function toAbsoluteHref(href: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return href;
  if (href.startsWith('#')) return `${DOCS_URL}${href}`;
  if (href.startsWith('/')) return `${PUBLIC_ORIGIN}${href}`;
  const chapter = /^([^/#?]+)\.md(?:#(.+))?$/.exec(href);
  if (chapter) {
    const [, file, fragment] = chapter;
    return `${DOCS_URL}#${fragment ? `${file}--${fragment}` : file}`;
  }
  return `${DOCS_URL}${href.replace(/^\.\//, '')}`;
}

/** Replace `{{snippet:x}}` with a fenced block of docs/snippets/x. */
export function inlineSnippets(markdown: string, snippetsDir = SNIPPETS_DIR): string {
  return markdown.replace(/\{\{snippet:([A-Za-z0-9_.-]+)\}\}/g, (_m, file: string) => {
    const source = fs.readFileSync(path.join(snippetsDir, file), 'utf8').replace(/\s+$/, '');
    const lang = SNIPPET_LANGUAGES[path.extname(file)] ?? '';
    return `\`\`\`${lang}\n${source}\n\`\`\``;
  });
}

const EXAMPLES: Readonly<Record<string, unknown>> = {
  server: SERVER_BATCH_EXAMPLE,
  browser: BROWSER_BATCH_EXAMPLE,
};

/** Replace `{{example:server}}` / `{{example:browser}}` with the canonical payload. */
export function inlineExamples(markdown: string): string {
  return markdown.replace(/\{\{example:([a-z]+)\}\}/g, (_m, name: string) => {
    const example = EXAMPLES[name];
    if (example === undefined) throw new Error(`build-docs: unknown example {{example:${name}}}`);
    return `\`\`\`json\n${JSON.stringify(example, null, 2)}\n\`\`\``;
  });
}

/** Replace `{{TOKEN}}`; an unknown token throws so typos never reach other teams. */
export function substituteTokens(markdown: string, tokens = TOKENS): string {
  return markdown.replace(/\{\{([A-Z_]+)\}\}/g, (_m, name: string) => {
    const value = tokens[name];
    if (value === undefined) throw new Error(`build-docs: unknown token {{${name}}}`);
    return value;
  });
}

// ─── Markdown → HTML ────────────────────────────────────────────────────────

interface Chapter {
  id: string;
  title: string;
  html: string;
}

/** One Marked instance per chapter, so heading ids are prefixed with the chapter id. */
function createChapterRenderer(chapterId: string): Marked {
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading(
        this: { parser: { parseInline: (t: Tokens.Heading['tokens']) => string } },
        token: Tokens.Heading,
      ) {
        const inner = this.parser.parseInline(token.tokens);
        const id = token.depth === 1 ? chapterId : `${chapterId}--${slugify(token.text)}`;
        return `<h${token.depth} id="${id}"><a class="anchor" href="${DOCS_URL}#${id}">#</a>${inner}</h${token.depth}>\n`;
      },
      link(
        this: { parser: { parseInline: (t: Tokens.Link['tokens']) => string } },
        token: Tokens.Link,
      ) {
        const inner = this.parser.parseInline(token.tokens);
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
        return `<a href="${escapeHtml(toAbsoluteHref(token.href))}"${title}>${inner}</a>`;
      },
    },
  });
  return marked;
}

/** The first `# Heading` of a chapter is its nav title. */
function chapterTitle(markdown: string, fallback: string): string {
  return /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? fallback;
}

/** Read, substitute and render one chapter file. */
export function renderChapter(fileName: string, markdown: string): Chapter {
  const id = chapterIdOf(fileName);
  // Tokens first: snippet/example bodies are inserted verbatim afterwards (code may contain {{ }}).
  const prepared = inlineExamples(inlineSnippets(substituteTokens(markdown)));
  const html = createChapterRenderer(id).parse(prepared, { async: false }) as string;
  return { id, title: chapterTitle(prepared, id), html };
}

function listChapterFiles(): string[] {
  return fs
    .readdirSync(CHAPTERS_DIR)
    .filter((file) => file.endsWith('.md'))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

// ─── Page template ──────────────────────────────────────────────────────────

const CSS = `
:root{color-scheme:light dark;--bg:#ffffff;--fg:#1f2328;--muted:#59636e;--line:#d1d9e0;
--panel:#f6f8fa;--accent:#0b62d6;--code:#eff2f5}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#9198a1;--line:#30363d;
--panel:#151b23;--accent:#4493f8;--code:#1c2330}}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--fg);
font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}
nav{position:fixed;inset:0 auto 0 0;width:280px;overflow-y:auto;padding:24px 20px;
background:var(--panel);border-right:1px solid var(--line)}
nav .brand{font-weight:700;font-size:15px;margin:0 0 4px}
nav .meta{color:var(--muted);font-size:13px;margin:0 0 16px}
nav ol{list-style:none;margin:0;padding:0}
nav li a{display:block;padding:5px 8px;border-radius:6px;color:var(--fg);text-decoration:none;font-size:14px}
nav li a:hover{background:var(--code)}
main{margin-left:280px;padding:32px 48px 96px;max-width:1040px}
section{border-bottom:1px solid var(--line);padding-bottom:32px;margin-bottom:32px}
h1,h2,h3,h4{line-height:1.25;scroll-margin-top:16px}
h1{font-size:30px;margin-top:8px}h2{font-size:22px;margin-top:36px}h3{font-size:18px}
.anchor{float:left;margin-left:-20px;width:20px;color:var(--muted);text-decoration:none;visibility:hidden}
h1:hover .anchor,h2:hover .anchor,h3:hover .anchor,h4:hover .anchor{visibility:visible}
code{font:13.5px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--code);
padding:2px 5px;border-radius:5px}
pre{background:var(--code);border:1px solid var(--line);border-radius:8px;padding:14px 16px;overflow-x:auto}
pre code{background:none;padding:0}
table{border-collapse:collapse;display:block;overflow-x:auto;margin:16px 0}
th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}
th{background:var(--panel)}
blockquote{margin:16px 0;padding:8px 16px;border-left:4px solid var(--accent);background:var(--panel);
border-radius:0 8px 8px 0}
footer{color:var(--muted);font-size:13px}
@media (max-width:900px){nav{position:static;width:auto;border-right:0;border-bottom:1px solid var(--line)}
main{margin-left:0;padding:24px 16px 64px}}
`;

function renderNav(chapters: Chapter[]): string {
  const items = chapters
    .map((c) => `<li><a href="${DOCS_URL}#${c.id}">${escapeHtml(c.title)}</a></li>`)
    .join('\n');
  return [
    '<nav aria-label="Chapters">',
    '<p class="brand">Data Nexus Traffic</p>',
    `<p class="meta">Integration guide · contract v${INGEST_CONTRACT_VERSION}</p>`,
    `<ol>\n${items}\n</ol>`,
    '</nav>',
  ].join('\n');
}

/** The single self-contained page. */
export function renderPage(chapters: Chapter[], builtAt: Date): string {
  const sections = chapters
    .map((c) => `<section id="section-${c.id}">\n${c.html}</section>`)
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Data Nexus Traffic — integration guide</title>
<style>${CSS}</style>
</head>
<body>
${renderNav(chapters)}
<main>
${sections}
<footer>Contract v${INGEST_CONTRACT_VERSION} · built ${builtAt.toISOString()} ·
<a href="${DOCS_URL}openapi.json">openapi.json</a> · questions: ${escapeHtml(DOCS_CONTACT)}</footer>
</main>
</body>
</html>
`;
}

// ─── Output steps ───────────────────────────────────────────────────────────

function resetDist(): void {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_FILES_DIR, { recursive: true });
}

function writeIndex(): number {
  const chapters = listChapterFiles().map((file) =>
    renderChapter(file, fs.readFileSync(path.join(CHAPTERS_DIR, file), 'utf8')),
  );
  fs.writeFileSync(path.join(DIST_DIR, 'index.html'), renderPage(chapters, new Date()));
  return chapters.length;
}

function copySnippets(): number {
  const target = path.join(DIST_FILES_DIR, 'snippets');
  fs.mkdirSync(target, { recursive: true });
  const files = fs.readdirSync(SNIPPETS_DIR).filter((f) => !f.startsWith('.'));
  for (const file of files) fs.copyFileSync(path.join(SNIPPETS_DIR, file), path.join(target, file));
  return files.length;
}

/** Served as files/examples/* (ROUTES.docs.files is the only file route). */
function writeExamples(): void {
  const target = path.join(DIST_FILES_DIR, 'examples');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(
    path.join(target, 'server-batch.json'),
    `${JSON.stringify(SERVER_BATCH_EXAMPLE, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(target, 'browser-batch.json'),
    `${JSON.stringify(BROWSER_BATCH_EXAMPLE, null, 2)}\n`,
  );
}

function main(): void {
  resetDist();
  const chapters = writeIndex();
  const snippets = copySnippets();
  writeExamples();
  writeOpenApi(DIST_OPENAPI_PATH, serializeOpenApi(buildOpenApiDocument()));
  console.log(
    `docs/dist: ${chapters} chapters, ${snippets} snippets, 2 examples, openapi.json → ${DOCS_URL}`,
  );
}

if (typeof require !== 'undefined' && require.main === module) main();
