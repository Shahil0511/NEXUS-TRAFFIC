import { INGEST_LIMITS } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { normalizeSchemaPath, schemaPathOfConstraint } from './schema-path';

const STORED_SHAPE = /^[A-Za-z0-9_.*]*$/;

describe('normalizeSchemaPath', () => {
  it.each([
    [[], ''],
    [['status'], 'status'],
    [['user', 'email'], 'user.email'],
    [['events', 3, 'path'], 'events.*.path'],
    // the key after `props` is sender-chosen text
    [['props', 'customer_9876543210'], 'props.*'],
    [['props', 'ok'], 'props.*'],
    // anything that is not a plain field name
    [['some field'], '*'],
    [['a@b.com'], '*'],
    [['_private'], '*'],
    [[Symbol('x')], '*'],
    [['x'.repeat(41)], '*'],
  ] as [PropertyKey[], string][])('%j → %s', (path, expected) => {
    const result = normalizeSchemaPath(path);
    expect(result).toBe(expected);
    expect(result).toMatch(STORED_SHAPE);
  });

  it('cuts at maxSchemaPathLength', () => {
    const result = normalizeSchemaPath(Array.from({ length: 60 }, () => 'abcde'));
    expect(result.length).toBe(INGEST_LIMITS.maxSchemaPathLength);
  });
});

describe('schemaPathOfConstraint', () => {
  it('keeps a constraint identifier', () => {
    expect(schemaPathOfConstraint('web_events_label_check')).toBe('web_events_label_check');
  });

  it.each([[undefined], [''], ['bad name'], ['x;DROP']])('returns "" for %s', (name) => {
    expect(schemaPathOfConstraint(name)).toBe('');
  });
});
