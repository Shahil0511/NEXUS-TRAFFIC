/**
 * WHY: skeleton bodies were built as `throw notImplemented(...)` while a step was in progress.
 * This guard makes sure none of that scaffolding (the marker file or a call to it) ever reaches main.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC_DIR = path.resolve(__dirname, '../src');
const FORBIDDEN_MARKERS = ['notImplemented(', 'not-implemented'] as const;

/** Every file under `dir`, recursively, as absolute paths. */
function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

/** `file: marker` for every forbidden marker found in the file's name or content. */
function offencesIn(file: string): string[] {
  const relative = path.relative(SRC_DIR, file).replace(/\\/g, '/');
  const haystack = `${relative}\n${readFileSync(file, 'utf8')}`;
  return FORBIDDEN_MARKERS.filter((marker) => haystack.includes(marker)).map(
    (marker) => `${relative}: ${marker}`,
  );
}

describe('no scaffolding left in apps/api/src', () => {
  it('has no notImplemented() call and no not-implemented module', () => {
    const offences = listFiles(SRC_DIR).flatMap(offencesIn);
    expect(offences).toEqual([]);
  });
});
