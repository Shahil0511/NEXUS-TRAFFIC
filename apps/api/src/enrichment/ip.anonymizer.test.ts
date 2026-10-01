import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { classifyIp, formatIpv6, IpAnonymizer, ipv6Hextets, truncateIp } from './ip.anonymizer';

const SECRET = 's'.repeat(64);

describe('IpAnonymizer.normalize', () => {
  const anonymizer = new IpAnonymizer('full', SECRET);

  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['  203.0.113.7 ', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['::FFFF:203.0.113.7', '203.0.113.7'],
    ['2001:DB8::1', '2001:db8::1'],
    ['::1', '::1'],
    ['::ffff:abcd', '::ffff:abcd'],
    ['fe80::1%eth0', 'fe80::1'],
    ['2001:0db8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
    ['2001:db8:0:0:1:0:0:1', '2001:db8::1:0:0:1'],
    ['2001:db8:0:1:1:1:1:1', '2001:db8:0:1:1:1:1:1'],
  ])('%s → %s', (raw, expected) => {
    expect(anonymizer.normalize(raw)).toBe(expected);
  });

  it.each([undefined, null, '', 'unknown', '203.0.113.7:8080', '256.1.1.1', '1.2.3', '[::1]'])(
    'invalid %s → null',
    (raw) => {
      expect(anonymizer.normalize(raw)).toBeNull();
    },
  );
});

describe('classifyIp', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback'],
    ['::1', 'loopback'],
    ['10.0.0.1', 'private'],
    ['10.255.255.255', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['172.15.255.255', 'public'],
    ['172.32.0.0', 'public'],
    ['192.168.1.1', 'private'],
    ['192.169.0.1', 'public'],
    ['169.254.10.10', 'private'],
    ['100.64.0.1', 'private'],
    ['100.127.255.255', 'private'],
    ['100.128.0.0', 'public'],
    ['100.63.255.255', 'public'],
    ['fc00::1', 'private'],
    ['fd12:3456::1', 'private'],
    ['fe80::1', 'private'],
    ['febf::1', 'private'],
    ['fec0::1', 'public'],
    ['2001:db8::1', 'public'],
    ['8.8.8.8', 'public'],
    ['::2', 'public'],
  ] as const)('%s → %s', (ip, expected) => {
    expect(classifyIp(ip)).toBe(expected);
  });

  it.each([null, '', 'nope'])('%s → unknown', (ip) => {
    expect(classifyIp(ip)).toBe('unknown');
  });
});

describe('ipv6Hextets / truncateIp', () => {
  it('expands compressed forms', () => {
    expect(ipv6Hextets('2001:db8::1')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]);
    expect(ipv6Hextets('::')).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(ipv6Hextets('fe80::')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 0]);
    expect(ipv6Hextets('64:ff9b::192.0.2.33')).toEqual([0x64, 0xff9b, 0, 0, 0, 0, 0xc000, 0x221]);
    expect(ipv6Hextets('1.2.3.4')).toBeNull();
  });

  it.each([
    [[0, 0, 0, 0, 0, 0, 0, 0], '::'],
    [[0, 0, 0, 0, 0, 0, 0, 1], '::1'],
    [[0xfe80, 0, 0, 0, 0, 0, 0, 0], 'fe80::'],
    [[1, 0, 0, 2, 0, 0, 0, 3], '1:0:0:2::3'],
    [[1, 0, 2, 0, 3, 0, 4, 0], '1:0:2:0:3:0:4:0'],
  ])('formats %j as %s', (hextets, expected) => {
    expect(formatIpv6(hextets)).toBe(expected);
  });

  it.each([
    ['203.0.113.77', '203.0.113.0'],
    ['2001:db8:85a3:8d3:1319:8a2e:370:7348', '2001:db8:85a3::'],
    ['2001:db8::1', '2001:db8::'],
  ])('truncates %s → %s', (ip, expected) => {
    expect(truncateIp(ip)).toBe(expected);
  });
});

describe('IpAnonymizer.anonymize', () => {
  const expectedHash = (ip: string) => createHmac('sha256', SECRET).update(ip).digest();

  it.each([
    ['full', '203.0.113.77', '203.0.113.77'],
    ['truncated', '203.0.113.77', '203.0.113.0'],
    ['hashed', '203.0.113.77', null],
    ['full', '2001:db8:85a3:8d3::7348', '2001:db8:85a3:8d3::7348'],
    ['truncated', '2001:db8:85a3:8d3::7348', '2001:db8:85a3::'],
    ['hashed', '2001:db8:85a3:8d3::7348', null],
  ] as const)('%s mode: %s → %s', (mode, ip, stored) => {
    const result = new IpAnonymizer(mode, SECRET).anonymize(ip);
    expect(result.ip).toBe(stored);
    expect(result.ipClass).toBe('public');
    expect(result.ipHash?.equals(expectedHash(ip))).toBe(true);
  });

  it('hashes the normalized (unmapped) address', () => {
    const result = new IpAnonymizer('full', SECRET).anonymize('::ffff:10.1.2.3');
    expect(result).toMatchObject({ ip: '10.1.2.3', ipClass: 'private' });
    expect(result.ipHash?.equals(expectedHash('10.1.2.3'))).toBe(true);
  });

  it('no or invalid ip → nothing stored, class unknown', () => {
    const anonymizer = new IpAnonymizer('full', SECRET);
    expect(anonymizer.anonymize(null)).toEqual({ ip: null, ipHash: null, ipClass: 'unknown' });
    expect(anonymizer.anonymize('garbage')).toEqual({ ip: null, ipHash: null, ipClass: 'unknown' });
  });

  it('classify() normalizes first', () => {
    expect(new IpAnonymizer('full', SECRET).classify('::ffff:127.0.0.1')).toBe('loopback');
  });
});
