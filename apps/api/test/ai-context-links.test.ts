/**
 * ai-context can never silently rot: every file path it mentions must exist.
 *
 * Checked in every `ai-context/**\/*.md` (and the repo-root DEPLOY.md / CLAUDE.md / AGENTS.md):
 * - markdown links `[text](relative/path#anchor)` → resolved from the document's folder;
 * - code spans that look like repo paths (`apps/…`, `packages/…`, `scripts/…`, `ops/…`, `docs/…`,
 *   `ai-context/…`, `.github/…`) → resolved from the repo root.
 * Skipped: URLs, pure anchors, globs/placeholders (`*`, `<…>`, `…`, `{…}`, `NNNN`), build output
 * that only exists after a build (`docs/dist/`, `.next/`, `node_modules/`, `backups/`), and the
 * table under "Per-app hints" in 08-integration-contract.md (paths inside OTHER teams' repos).
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const AI_CONTEXT = path.join(REPO_ROOT, 'ai-context');
const ROOT_DOCS = ['DEPLOY.md', 'CLAUDE.md', 'AGENTS.md'];
const REPO_PATH = /^(?:apps|packages|scripts|ops|docs|ai-context|\.github)\/[^\s]+$/;
const PLACEHOLDER = /[*<>…{}]|NNNN|YYYY/;
const BUILD_OUTPUT = /(?:^docs\/dist(?:\/|$))|(?:\.next\/)|(?:node_modules\/)|(?:^backups\/)/;
/** Section whose table lists files in other teams' repositories (we never touch D:\server). */
const OTHER_TEAMS_SECTION = { file: '08-integration-contract.md', heading: /^## Per-app hints/ };

function markdownFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(full);
    return entry.name.endsWith('.md') ? [full] : [];
  });
}

/** Lines that are checked: everything except the other-teams table. */
function checkedLines(file: string): Array<{ line: string; number: number }> {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const exemptSection = path.basename(file) === OTHER_TEAMS_SECTION.file;
  let inOtherTeams = false;
  let inFence = false;
  const result: Array<{ line: string; number: number }> = [];
  lines.forEach((line, i) => {
    if (line.startsWith('```')) inFence = !inFence;
    if (/^#{1,6} /.test(line))
      inOtherTeams = exemptSection && OTHER_TEAMS_SECTION.heading.test(line);
    if (inOtherTeams && line.startsWith('|')) return;
    if (inFence) return; // shell examples, not references
    result.push({ line, number: i + 1 });
  });
  return result;
}

interface Reference {
  doc: string;
  line: number;
  target: string;
  resolved: string;
}

function referencesIn(file: string): Reference[] {
  const doc = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
  const refs: Reference[] = [];
  for (const { line, number } of checkedLines(file)) {
    for (const [, target] of line.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (!target || /^[a-z]+:/i.test(target) || target.startsWith('#')) continue;
      const clean = decodeURI(target.split('#')[0]!);
      if (!clean || PLACEHOLDER.test(clean)) continue;
      refs.push({ doc, line: number, target, resolved: path.resolve(path.dirname(file), clean) });
    }
    for (const [, span] of line.matchAll(/`([^`]+)`/g)) {
      const candidate = span
        ?.trim()
        .replace(/[.,;:]$/, '')
        .split('#')[0];
      if (!candidate || !REPO_PATH.test(candidate)) continue;
      if (PLACEHOLDER.test(candidate) || BUILD_OUTPUT.test(candidate)) continue;
      refs.push({
        doc,
        line: number,
        target: candidate,
        resolved: path.join(REPO_ROOT, candidate),
      });
    }
  }
  return refs;
}

const DOCS = [
  ...markdownFiles(AI_CONTEXT),
  ...ROOT_DOCS.map((name) => path.join(REPO_ROOT, name)).filter((file) => fs.existsSync(file)),
];
const REFERENCES = DOCS.flatMap(referencesIn);

describe('ai-context doc links', () => {
  it('finds the documents and a meaningful number of references', () => {
    expect(DOCS.length).toBeGreaterThanOrEqual(12);
    expect(REFERENCES.length).toBeGreaterThan(100);
  });

  it('every referenced repo path exists', () => {
    const missing = REFERENCES.filter((ref) => !fs.existsSync(ref.resolved)).map(
      (ref) => `${ref.doc}:${ref.line} → ${ref.target}`,
    );
    expect(missing).toEqual([]);
  });

  it('exempts ONLY the other-teams table (its paths are not in this repo)', () => {
    const contract = path.join(AI_CONTEXT, OTHER_TEAMS_SECTION.file);
    const all = fs.readFileSync(contract, 'utf8').split(/\r?\n/).length;
    const exempt = all - checkedLines(contract).length;
    expect(exempt).toBeGreaterThan(0);
    expect(exempt).toBeLessThanOrEqual(10);
  });
});
