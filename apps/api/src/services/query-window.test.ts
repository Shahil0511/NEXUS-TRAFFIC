import { ERROR_CODES, MAX_PERCENTILE_RANGE_MS } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { BadRequestError, ValidationError } from '../errors/app-error';
import {
  currentFilter,
  previousFilter,
  resolveQueryWindow,
  toTimeWindowDto,
  toWindowHttpError,
} from './query-window';

const NOW = new Date('2026-10-01T10:00:00.000Z');

/** Runs `fn` and returns what it threw. */
function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected a throw');
}

describe('resolveQueryWindow', () => {
  it('maps a too-large range to 400 RANGE_TOO_LARGE', () => {
    const err = thrownBy(() => resolveQueryWindow({ range: '90d' }, NOW, MAX_PERCENTILE_RANGE_MS));
    expect(err).toBeInstanceOf(BadRequestError);
    expect(err).toMatchObject({ statusCode: 400, code: ERROR_CODES.RANGE_TOO_LARGE });
  });

  it('maps an inverted custom range to a 400 validation error', () => {
    const inverted = {
      range: 'custom' as const,
      from: '2026-10-02T00:00:00Z',
      to: '2026-10-01T00:00:00Z',
    };
    const err = thrownBy(() => resolveQueryWindow(inverted, NOW, MAX_PERCENTILE_RANGE_MS));
    expect(err).toBeInstanceOf(ValidationError);
    expect(err).toMatchObject({ statusCode: 400, code: ERROR_CODES.VALIDATION_ERROR });
  });

  it('leaves unrelated errors untouched', () => {
    const other = new Error('boom');
    expect(toWindowHttpError(other)).toBe(other);
  });

  it('builds current / previous filters and the echoed window', () => {
    const window = resolveQueryWindow({ range: '1h' }, NOW, MAX_PERCENTILE_RANGE_MS);
    expect(currentFilter(window, 'app')).toEqual({
      from: new Date('2026-10-01T09:00:00Z'),
      to: NOW,
      appId: 'app',
    });
    expect(previousFilter(window, undefined)).toEqual({
      from: new Date('2026-10-01T08:00:00Z'),
      to: new Date('2026-10-01T09:00:00Z'),
      appId: undefined,
    });
    expect(toTimeWindowDto(window)).toEqual({
      from: '2026-10-01T09:00:00.000Z',
      to: NOW.toISOString(),
      grain: 'minute',
    });
  });
});
