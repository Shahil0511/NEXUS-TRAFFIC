import { describe, expect, it } from 'vitest';

import { TOOL_NAME_PATTERN } from './ingest';
import {
  isGstinChecksumValid,
  isVerhoeffValid,
  PII_DETECTION_ORDER,
  PII_FIELD_VALUES,
  PII_IDENTIFIER_REDACTION,
  PII_KIND_VALUES,
  PII_MIN_MATCH_LENGTH,
  PII_PATH_PATTERN_SOURCES,
  PII_REDACTION_TOKENS,
  PII_SEGMENT_PATTERN_SOURCES,
  PII_TEXT_PATTERN_SOURCES,
  type PiiKind,
} from './pii';

/** Appends the Verhoeff check digit to `body` by trying all ten (uses the implementation itself). */
function withVerhoeffDigit(body: string): string {
  for (let d = 0; d <= 9; d += 1) {
    if (isVerhoeffValid(`${body}${d}`)) return `${body}${d}`;
  }
  throw new Error('no Verhoeff digit found');
}

/** A 12-digit run with a WRONG check digit (there is exactly one right one). */
function withWrongVerhoeffDigit(body: string): string {
  const right = withVerhoeffDigit(body).slice(-1);
  return `${body}${(Number(right) + 1) % 10}`;
}

const AADHAAR = withVerhoeffDigit('23456789012');
const NOT_AADHAAR = withWrongVerhoeffDigit(AADHAAR.slice(0, 11));

function matchesOf(source: string, text: string): string[] {
  return [...text.matchAll(new RegExp(source, 'gi'))].map((m) => m[0]);
}

function detect(sources: Readonly<Record<PiiKind, string>>, kind: PiiKind, text: string): string[] {
  const found = matchesOf(sources[kind], text);
  if (kind === 'aadhaar') return found.filter(isVerhoeffValid);
  if (kind === 'gstin') return found.filter(isGstinChecksumValid);
  return found;
}

describe('PII constants', () => {
  it('has a token and a minimum length for every kind; tokens never lengthen a field', () => {
    for (const kind of PII_KIND_VALUES) {
      expect(PII_REDACTION_TOKENS[kind].length, kind).toBeLessThanOrEqual(PII_MIN_MATCH_LENGTH[kind]);
    }
  });

  it('the identifier redaction is a valid tool / custom name', () => {
    expect(TOOL_NAME_PATTERN.test(PII_IDENTIFIER_REDACTION)).toBe(true);
  });

  it('detects every kind exactly once, in a fixed order', () => {
    expect([...PII_DETECTION_ORDER].sort()).toEqual([...PII_KIND_VALUES].sort());
    expect(PII_DETECTION_ORDER[0]).toBe('email');
    expect(new Set(PII_FIELD_VALUES).size).toBe(PII_FIELD_VALUES.length);
  });

  it('every pattern source compiles with the gi flags', () => {
    for (const kind of PII_KIND_VALUES) {
      expect(() => new RegExp(PII_PATH_PATTERN_SOURCES[kind], 'gi')).not.toThrow();
      expect(() => new RegExp(PII_TEXT_PATTERN_SOURCES[kind], 'gi')).not.toThrow();
    }
  });
});

describe('checksums', () => {
  it('validates the Verhoeff check digit', () => {
    expect(AADHAAR).toHaveLength(12);
    expect(isVerhoeffValid(AADHAAR)).toBe(true);
    expect(isVerhoeffValid(`${AADHAAR.slice(0, 4)} ${AADHAAR.slice(4, 8)}-${AADHAAR.slice(8)}`)).toBe(true);
    expect(isVerhoeffValid(`${AADHAAR.slice(0, 4)}%20${AADHAAR.slice(4, 8)}%20${AADHAAR.slice(8)}`)).toBe(true);
    expect(isVerhoeffValid('%20')).toBe(false);
    expect(isVerhoeffValid(NOT_AADHAAR)).toBe(false);
    expect(isVerhoeffValid('')).toBe(false);
    expect(isVerhoeffValid('12a4')).toBe(false);
    // Known vector: 236 → check digit 3.
    expect(isVerhoeffValid('2363')).toBe(true);
  });

  it('validates the GSTIN mod-36 check character (case-insensitive)', () => {
    expect(isGstinChecksumValid('27AAPFU0939F1ZV')).toBe(true);
    expect(isGstinChecksumValid('27aapfu0939f1zv')).toBe(true);
    expect(isGstinChecksumValid('27AAPFU0939F1ZW')).toBe(false);
    expect(isGstinChecksumValid('27AAPFU0939F1Z')).toBe(false);
    expect(isGstinChecksumValid('27AAPFU0939F1Z!')).toBe(false);
  });
});

describe('PATH patterns (pass 1, strict)', () => {
  const P = PII_PATH_PATTERN_SOURCES;

  it('finds emails, also URL-encoded', () => {
    expect(detect(P, 'email', '/app/users/someone@libas.in/edit')).toEqual(['someone@libas.in']);
    expect(detect(P, 'email', '/app/users/a%40b.com')).toEqual(['a%40b.com']);
  });

  it('finds PAN in any case and GSTIN with a valid checksum', () => {
    expect(detect(P, 'pan', '/app/kyc/ABCPE1234F')).toEqual(['ABCPE1234F']);
    expect(detect(P, 'pan', '/app/kyc/abcpe1234f')).toEqual(['abcpe1234f']);
    expect(detect(P, 'gstin', '/app/gst/27AAPFU0939F1ZV/view')).toEqual(['27AAPFU0939F1ZV']);
    expect(detect(P, 'gstin', '/app/gst/27AAPFU0939F1ZW/view')).toEqual([]);
  });

  it('finds an Aadhaar only with separators, and a phone only with +91', () => {
    const spaced = `${AADHAAR.slice(0, 4)}-${AADHAAR.slice(4, 8)}-${AADHAAR.slice(8)}`;
    expect(detect(P, 'aadhaar', `/app/kyc/${spaced}`)).toEqual([spaced]);
    const encoded = `${AADHAAR.slice(0, 4)}%20${AADHAAR.slice(4, 8)}%20${AADHAAR.slice(8)}`;
    expect(detect(P, 'aadhaar', `/app/kyc/${encoded}`)).toEqual([encoded]);
    expect(detect(P, 'aadhaar', `/app/kyc/${AADHAAR}`)).toEqual([]);
    expect(detect(P, 'phone', '/app/call/+91 9876543210')).toEqual(['+91 9876543210']);
    expect(detect(P, 'phone', '/app/call/%2B919876543210')).toEqual(['%2B919876543210']);
    expect(detect(P, 'phone', '/app/call/+91-98765-43210')).toEqual(['+91-98765-43210']);
    expect(detect(P, 'phone', '/app/call/%2B91%2098765%2043210')).toEqual(['%2B91%2098765%2043210']);
  });

  it('leaves 10-digit runs inside opaque ids alone (request ids, releases)', () => {
    for (const id of ['a1b2c3d4e5f6a7b89876543210abcdef', '9876543210ab4c4f-9a51-2f0f3d7f6a11']) {
      for (const kind of PII_KIND_VALUES) expect(detect(P, kind, id), `${kind} in ${id}`).toEqual([]);
    }
  });

  it('leaves numeric ids, uuids and tool-like names alone', () => {
    const path = '/app/orders/9876543210/items/0b8f6c1e-5a2d-4c4f-9a51-2f0f3d7f6a11/audits.export-csv';
    for (const kind of PII_KIND_VALUES) expect(detect(P, kind, path), kind).toEqual([]);
  });
});

describe('TEXT patterns (pass 1, free text)', () => {
  const T = PII_TEXT_PATTERN_SOURCES;

  it('finds a bare mobile, +91 / 0091 / 0 prefixes and a bare Verhoeff-valid Aadhaar', () => {
    expect(detect(T, 'phone', 'call 9876543210 now')).toEqual(['9876543210']);
    expect(detect(T, 'phone', 'call +91 9876543210')).toEqual(['+91 9876543210']);
    expect(detect(T, 'phone', 'call 00919876543210')).toEqual(['00919876543210']);
    expect(detect(T, 'phone', 'Call 98765 43210')).toEqual(['98765 43210']);
    expect(detect(T, 'phone', 'call +91 98765 43210')).toEqual(['+91 98765 43210']);
    expect(detect(T, 'phone', 'call +91-98765-43210')).toEqual(['+91-98765-43210']);
    expect(detect(T, 'phone', 'wa.me/919876543210')).toEqual(['919876543210']);
    expect(detect(T, 'aadhaar', `id ${AADHAAR}`)).toEqual([AADHAAR]);
    expect(detect(T, 'aadhaar', `id ${NOT_AADHAAR}`)).toEqual([]);
  });

  it('finds emails, PAN and GSTIN in labels', () => {
    expect(detect(T, 'email', 'Mail someone@libas.in')).toEqual(['someone@libas.in']);
    expect(detect(T, 'pan', 'PAN ABCPE1234F')).toEqual(['ABCPE1234F']);
    expect(detect(T, 'gstin', 'GST 27AAPFU0939F1ZV')).toEqual(['27AAPFU0939F1ZV']);
  });

  it('leaves a uuid and a dotted tool name alone', () => {
    for (const text of ['0b8f6c1e-5a2d-4c4f-9a51-2f0f3d7f6a11', 'audits.export-csv']) {
      for (const kind of PII_KIND_VALUES) expect(detect(T, kind, text), `${kind} in ${text}`).toEqual([]);
    }
  });
});

describe('SEGMENT patterns (pass 2, stored paths)', () => {
  const phone = new RegExp(PII_SEGMENT_PATTERN_SOURCES.phone);
  const aadhaar = new RegExp(PII_SEGMENT_PATTERN_SOURCES.aadhaar);

  it('matches a whole bare mobile segment and a Verhoeff-valid 12-digit segment', () => {
    expect(phone.test('9876543210')).toBe(true);
    expect(phone.test('919876543210')).toBe(true);
    expect(aadhaar.test(AADHAAR) && isVerhoeffValid(AADHAAR)).toBe(true);
  });

  it('does not match parts of segments, other lengths or invalid Aadhaar', () => {
    expect(phone.test('19876543210')).toBe(false);
    expect(phone.test('5876543210')).toBe(false);
    expect(phone.test('929876543210')).toBe(false);
    expect(phone.test('order-9876543210')).toBe(false);
    expect(aadhaar.test(NOT_AADHAAR) && isVerhoeffValid(NOT_AADHAAR)).toBe(false);
    expect(aadhaar.test('12345678901')).toBe(false);
  });
});
