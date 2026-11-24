/**
 * WHY: the person pages show facts about ONE person per day, never a judgement of that person
 * (ADR 0017). A DTO field is the contract every screen reads, so a field named for a judgement
 * (a score, a rank, a position in a list of people) would invite a screen to show one. This test
 * reads the DTO SOURCE files and fails on such a field name, whichever DTO it is added to.
 *
 * @see ../../../ai-context/decisions/0017-person-daily-depth.md
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const DTO_DIR = path.join(__dirname, 'dto');

/**
 * Field names that frame a person as judged, compared or watched: the banned screen words in
 * camelCase / snake_case form, plus percentile and position. NEVER loosen it to let a field in.
 */
const BANNED_FIELD_NAME =
  /score|rank|percentile|position|productiv|performance|performer|attendance|leaderboard|hoursWorked|hours_worked|absent|absence|employee|staff|monitor|surveillance/i;

/** Block and line comments removed, so doc prose never counts as a field. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * Every `name:` / `name?:` / `readonly name:` property of the interfaces and inline object types
 * in one DTO file. Pure.
 */
function dtoFieldNames(source: string): string[] {
  const code = stripComments(source);
  const names: string[] = [];
  for (const match of code.matchAll(/(?:^|[{;,])\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*:/gm)) {
    const name = match[1];
    if (name) names.push(name);
  }
  return names;
}

function dtoFiles(): string[] {
  return readdirSync(DTO_DIR)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .sort();
}

describe('DTO field names (ADR 0017)', () => {
  it('reads the field names of every DTO file', () => {
    const files = dtoFiles();
    expect(files).toEqual(expect.arrayContaining(['users.ts', 'privacy.ts', 'journeys.ts']));
    const users = dtoFieldNames(readFileSync(path.join(DTO_DIR, 'users.ts'), 'utf8'));
    // A sanity check that the extraction works: known fields of the daily row.
    expect(users).toEqual(expect.arrayContaining(['firstActivityAt', 'activeMs', 'inProgress']));
  });

  it.each(dtoFiles())('%s names no field for a score, rank or judgement', (file) => {
    const names = dtoFieldNames(readFileSync(path.join(DTO_DIR, file), 'utf8'));
    expect(names.filter((name) => BANNED_FIELD_NAME.test(name))).toEqual([]);
  });

  it('catches a banned field in a nested type and ignores one in a comment', () => {
    const source = [
      'export interface X {',
      '  /** rank: in a comment only */',
      '  day: string;',
      '  items: Array<{ app: string; readonly topScore?: number; hoursWorked: number }>;',
      '  // position: also a comment',
      '  absentDays?: number;',
      '  staffId: string;',
      '  monitoredAt: string;',
      '}',
    ].join('\n');
    const names = dtoFieldNames(source);
    expect(names).toEqual([
      'day',
      'items',
      'app',
      'topScore',
      'hoursWorked',
      'absentDays',
      'staffId',
      'monitoredAt',
    ]);
    expect(names.filter((name) => BANNED_FIELD_NAME.test(name))).toEqual([
      'topScore',
      'hoursWorked',
      'absentDays',
      'staffId',
      'monitoredAt',
    ]);
  });
});
