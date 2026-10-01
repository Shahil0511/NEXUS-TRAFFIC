import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyEnvChanges,
  ensureDevEnvFile,
  GENERATED_KEYS,
  parseEnvText,
  readDevEnvFile,
  updateDevEnvFile,
} from './env-file';

let dir: string;
let file: string;
let counter: number;
const fakeHex = () => `hex${String(++counter).padStart(61, '0')}`;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-dev-env-'));
  file = path.join(dir, '.env.dev');
  counter = 0;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('ensureDevEnvFile', () => {
  it('creates the file with every generated key on the first run', () => {
    const result = ensureDevEnvFile(file, fakeHex);
    expect(result.created).toBe(true);
    for (const key of GENERATED_KEYS) expect(result.values[key]).toMatch(/^hex\d{61}$/);
    expect(new Set(GENERATED_KEYS.map((k) => result.values[k])).size).toBe(GENERATED_KEYS.length);
    expect(fs.readFileSync(file, 'utf8')).toContain('LOCAL DEV ONLY');
  });

  it('reuses the same values on later runs without rewriting the file', () => {
    const first = ensureDevEnvFile(file, fakeHex);
    const before = fs.readFileSync(file, 'utf8');
    const second = ensureDevEnvFile(file, () => 'should-not-be-used');
    expect(second.created).toBe(false);
    expect(second.addedKeys).toEqual([]);
    expect(second.values).toEqual(first.values);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  it('fills in only the missing keys of an existing file', () => {
    fs.writeFileSync(file, '# mine\nAPI_KEY_PEPPER=keep-me\nOTHER=x\n');
    const result = ensureDevEnvFile(file, fakeHex);
    expect(result.created).toBe(false);
    expect(result.values.API_KEY_PEPPER).toBe('keep-me');
    expect(result.addedKeys).not.toContain('API_KEY_PEPPER');
    expect(result.addedKeys).toHaveLength(GENERATED_KEYS.length - 1);
    const text = fs.readFileSync(file, 'utf8');
    expect(text.startsWith('# mine\nAPI_KEY_PEPPER=keep-me\nOTHER=x\n')).toBe(true);
  });
});

describe('updateDevEnvFile', () => {
  it('sets and deletes demo keys, keeping everything else', () => {
    ensureDevEnvFile(file, fakeHex);
    updateDevEnvFile(file, { DEMO_SECRET_KEY: 'nx_sk_x', DEMO_PUBLISHABLE_KEY: 'nx_pk_y' });
    expect(readDevEnvFile(file)).toMatchObject({ DEMO_SECRET_KEY: 'nx_sk_x', DEMO_PUBLISHABLE_KEY: 'nx_pk_y' });
    updateDevEnvFile(file, { DEMO_SECRET_KEY: null, DEMO_PUBLISHABLE_KEY: null });
    const values = readDevEnvFile(file);
    expect(values?.DEMO_SECRET_KEY).toBeUndefined();
    expect(values?.API_KEY_PEPPER).toMatch(/^hex/);
  });
});

describe('parseEnvText / applyEnvChanges', () => {
  it('ignores comments and strips quotes', () => {
    const map = parseEnvText('# c\nA=1\nB="two words"\n  C = \'3\'\nnot a line\n');
    expect([...map.entries()]).toEqual([
      ['A', '1'],
      ['B', 'two words'],
      ['C', '3'],
    ]);
  });

  it('replaces in place and appends new keys', () => {
    expect(applyEnvChanges('A=1\n# A=commented\nB=2\n', { A: '9', C: '3', B: null })).toBe('A=9\n# A=commented\nC=3\n');
  });
});
