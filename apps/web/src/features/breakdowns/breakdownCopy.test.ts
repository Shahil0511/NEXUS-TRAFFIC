import { BREAKDOWN_DIMENSION_VALUES, SERVER_BREAKDOWN_DIMENSION_VALUES } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import {
  breakdownValueLabel,
  DIMENSION_COPY,
  dimensionsFor,
  NOT_SENT_LABEL,
} from './breakdownCopy';

describe('breakdownValueLabel', () => {
  it('names known enum values in plain words', () => {
    expect(breakdownValueLabel('device', 'mobile')).toBe('Mobile');
    expect(breakdownValueLabel('nav', 'route')).toBe('In-app navigation');
    expect(breakdownValueLabel('time_reason', 'pagehide')).toBe('Page closed');
    expect(breakdownValueLabel('environment', 'prod')).toBe('Production');
  });

  it('shows ingested free text verbatim and null as "Not sent"', () => {
    expect(breakdownValueLabel('client_tz', 'Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(breakdownValueLabel('release', '<b>2026.11</b>')).toBe('<b>2026.11</b>');
    expect(breakdownValueLabel('device', 'toaster')).toBe('toaster');
    expect(breakdownValueLabel('release', null)).toBe(NOT_SENT_LABEL);
  });

  it('shows macOS without the frozen User-Agent version; other systems as stored', () => {
    expect(breakdownValueLabel('os', 'Mac OS 10')).toBe('macOS');
    expect(breakdownValueLabel('os', 'Windows 10')).toBe('Windows 10');
    expect(breakdownValueLabel('os', null)).toBe(NOT_SENT_LABEL);
  });

  it('never resolves a value to an Object.prototype member', () => {
    expect(breakdownValueLabel('environment', 'constructor')).toBe('constructor');
    expect(breakdownValueLabel('device', '__proto__')).toBe('__proto__');
    expect(breakdownValueLabel('nav', 'toString')).toBe('toString');
  });
});

describe('dimensionsFor', () => {
  it('offers every dimension for browser events and only the server columns for API calls', () => {
    expect(dimensionsFor('browser')).toEqual(BREAKDOWN_DIMENSION_VALUES);
    expect(dimensionsFor('server')).toEqual(SERVER_BREAKDOWN_DIMENSION_VALUES);
  });

  it('has copy for every dimension', () => {
    for (const dimension of BREAKDOWN_DIMENSION_VALUES) {
      expect(DIMENSION_COPY[dimension].label.trim()).not.toBe('');
    }
  });
});
