import { PII_IDENTIFIER_REDACTION, TOOL_NAME_PATTERN } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { invalidAadhaar, verhoeffAadhaar } from '../../test/ingest-fixtures';
import { PiiScrubber } from './pii.scrubber';

const scrubber = new PiiScrubber();
const AADHAAR = verhoeffAadhaar();
const SPACED_AADHAAR = `${AADHAAR.slice(0, 4)} ${AADHAAR.slice(4, 8)} ${AADHAAR.slice(8)}`;

describe('PiiScrubber.scrubPathLike (strict)', () => {
  it.each([
    ['/users/amit@libas.in/orders', '/users/:email/orders', ['email']],
    ['/users/a%40b.com', '/users/:email', ['email']],
    ['/pan/ABCPE1234F', '/pan/:pan', ['pan']],
    ['/pan/abcpe1234f/x', '/pan/:pan/x', ['pan']],
    ['/gst/27AAPFU0939F1ZV', '/gst/:gstin', ['gstin']],
    ['/call/+91 9876543210', '/call/:phone', ['phone']],
    ['/call/%2B919876543210', '/call/:phone', ['phone']],
    ['/call/+91-98765-43210', '/call/:phone', ['phone']],
    [`/kyc/${SPACED_AADHAAR.replace(/ /g, '-')}`, '/kyc/:aadhaar', ['aadhaar']],
  ])('%s → %s', (input, value, kinds) => {
    expect(scrubber.scrubPathLike(input)).toEqual({ value, kinds });
  });

  it.each([
    // a bare 10-digit id is NOT PII in pass 1 (it is caught by the segment pass on the stored path)
    ['/orders/9876543210'],
    [`/orders/${AADHAAR}`],
    ['/orders/5f0c1e2a-9b8d-4c7e-8f6a-1b2c3d4e5f60'],
    ['/tools/audits.export-csv'],
    // GSTIN-shaped but the checksum fails; PAN-shaped segments embedded in longer tokens
    ['/gst/27AAPFU0939F1ZX'],
    ['/x/XABCPE1234F'],
  ])('%s is untouched', (input) => {
    expect(scrubber.scrubPathLike(input)).toEqual({ value: input, kinds: [] });
  });

  it('a token is never longer than the match it replaces', () => {
    const input = '/a/x@y.co/ABCPE1234F/+919876543210';
    expect(scrubber.scrubPathLike(input).value.length).toBeLessThanOrEqual(input.length);
  });
});

describe('PiiScrubber.scrubText (free text)', () => {
  it.each([
    ['call 9876543210 now', 'call :phone now', ['phone']],
    ['call 09876543210', 'call :phone', ['phone']],
    ['+91-9876543210', ':phone', ['phone']],
    [`aadhaar ${AADHAAR}`, 'aadhaar :aadhaar', ['aadhaar']],
    [`aadhaar ${SPACED_AADHAAR}`, 'aadhaar :aadhaar', ['aadhaar']],
    ['mail me: a.b@libas.in', 'mail me: :email', ['email']],
    ['PAN ABCPE1234F and 9876543210', 'PAN :pan and :phone', ['pan', 'phone']],
    ['Call 98765 43210', 'Call :phone', ['phone']],
    ['+91 98765 43210', ':phone', ['phone']],
    ['+91-98765-43210', ':phone', ['phone']],
    ['wa.me/919876543210', 'wa.me/:phone', ['phone']],
  ])('%s → %s', (input, value, kinds) => {
    expect(scrubber.scrubText(input)).toEqual({ value, kinds });
  });

  it.each([['Save order'], ['order 12345'], [invalidAadhaar()], ['5f0c1e2a-9b8d-4c7e-8f6a-1b2c3d4e5f60'], ['2026.11.18-a1b2c3d']])(
    '%s is untouched',
    (input) => {
      expect(scrubber.scrubText(input)).toEqual({ value: input, kinds: [] });
    },
  );
});

describe('PiiScrubber.scrubOpaqueId (request_id, release)', () => {
  it.each([['a1b2c3d4e5f6a7b89876543210abcdef'], ['5f0c1e2a-9b8d-4c7e-8f6a-9876543210ab'], ['2026.11.18-a1b2c3d']])(
    '%s is kept (a digit run inside an opaque id is not a mobile)',
    (input) => {
      expect(scrubber.scrubOpaqueId(input)).toEqual({ value: input, kinds: [] });
    },
  );

  it('still finds a PAN or a +91 phone', () => {
    expect(scrubber.scrubOpaqueId('ABCPE1234F').kinds).toEqual(['pan']);
    expect(scrubber.scrubOpaqueId('req-+919876543210').kinds).toEqual(['phone']);
  });
});

describe('PiiScrubber.scrubIdentifier', () => {
  it('replaces with `redacted` and keeps TOOL_NAME_PATTERN', () => {
    const result = scrubber.scrubIdentifier('call-9876543210');
    expect(result).toEqual({ value: `call-${PII_IDENTIFIER_REDACTION}`, kinds: ['phone'] });
    expect(result.value).toMatch(TOOL_NAME_PATTERN);
  });

  it('leaves normal tool names alone', () => {
    expect(scrubber.scrubIdentifier('audits.export-csv')).toEqual({ value: 'audits.export-csv', kinds: [] });
  });
});

describe('PiiScrubber.scrubStoredPathSegments (pass 2)', () => {
  it('replaces a whole bare-mobile segment', () => {
    expect(scrubber.scrubStoredPathSegments('/customers/9876543210')).toEqual({
      value: '/customers/:phone',
      kinds: ['phone'],
    });
  });

  it('replaces a Verhoeff-valid 12-digit segment', () => {
    expect(scrubber.scrubStoredPathSegments(`/kyc/${AADHAAR}/x`)).toEqual({
      value: '/kyc/:aadhaar/x',
      kinds: ['aadhaar'],
    });
  });

  it.each([['/orders/1234567890'], [`/kyc/${invalidAadhaar()}`], ['/orders/98765432101'], ['/a/x9876543210']])(
    '%s is untouched',
    (input) => {
      expect(scrubber.scrubStoredPathSegments(input)).toEqual({ value: input, kinds: [] });
    },
  );
});
