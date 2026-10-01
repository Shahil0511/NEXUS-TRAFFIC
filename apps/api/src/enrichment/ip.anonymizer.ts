/**
 * Applies IP_STORAGE_MODE AFTER geo lookup:
 * - full:      store the IP as-is
 * - truncated: zero the last IPv4 octet (/24) or keep the first 48 bits of IPv6 (/48)
 * - hashed:    store no IP
 * ip_hash = HMAC-SHA256(IP_HASH_SECRET, ip) is always stored (distinct-visitor counts) when an IP exists.
 * Also classifies the IP (public / private / loopback / unknown).
 */
import { createHmac } from 'node:crypto';
import { isIP, isIPv4 } from 'node:net';

import type { IpClass, IpStorageMode } from '@nexus/shared';

export interface AnonymizedIp {
  ip: string | null;
  ipHash: Buffer | null;
  ipClass: IpClass;
}

const IPV4_MAPPED_PREFIX = '::ffff:';
const IPV6_HEXTET_COUNT = 8;
const IPV6_ZONE = /%.*$/;
/** truncated mode keeps a /48 = the first 3 hextets. */
const IPV6_TRUNCATED_HEXTETS = 3;

/** IPv4 private/link-local/CGNAT ranges as [first octet, second octet, prefix bits]. */
const IPV4_PRIVATE_RANGES: ReadonlyArray<readonly [number, number, number]> = [
  [10, 0, 8],
  [172, 16, 12],
  [192, 168, 16],
  [169, 254, 16],
  [100, 64, 10],
];

function parseHextets(part: string): number[] {
  return part ? part.split(':').map((hextet) => parseInt(hextet, 16)) : [];
}

/** Rewrites an embedded IPv4 tail (`::1.2.3.4`) as two hextets. */
function inlineIpv4Tail(ip: string): string {
  const lastColon = ip.lastIndexOf(':');
  const tail = ip.slice(lastColon + 1);
  if (!isIPv4(tail)) return ip;
  const [a = 0, b = 0, c = 0, d = 0] = tail.split('.').map(Number);
  const high = ((a << 8) | b).toString(16);
  const low = ((c << 8) | d).toString(16);
  return `${ip.slice(0, lastColon + 1)}${high}:${low}`;
}

/** WHY: classification and /48 truncation need the 8 numeric hextets of any IPv6 text form. */
export function ipv6Hextets(ip: string): number[] | null {
  if (isIP(ip) !== 6) return null;
  const [head = '', tail] = inlineIpv4Tail(ip.toLowerCase()).split('::');
  const left = parseHextets(head);
  if (tail === undefined) return left;
  const right = parseHextets(tail);
  const zeros = new Array<number>(IPV6_HEXTET_COUNT - left.length - right.length).fill(0);
  return [...left, ...zeros, ...right];
}

/** Longest run (≥ 2) of zero hextets as [start, length], or null. */
function longestZeroRun(hextets: number[]): [number, number] | null {
  let bestStart = -1;
  let bestLength = 1;
  let i = 0;
  while (i < hextets.length) {
    if (hextets[i] !== 0) {
      i += 1;
      continue;
    }
    const start = i;
    while (i < hextets.length && hextets[i] === 0) i += 1;
    if (i - start > bestLength) [bestStart, bestLength] = [start, i - start];
  }
  return bestStart === -1 ? null : [bestStart, bestLength];
}

/** WHY: one canonical spelling (RFC 5952: lower-case, longest zero run as `::`). */
export function formatIpv6(hextets: number[]): string {
  const hex = hextets.map((h) => h.toString(16));
  const run = longestZeroRun(hextets);
  if (!run) return hex.join(':');
  const [start, length] = run;
  return `${hex.slice(0, start).join(':')}::${hex.slice(start + length).join(':')}`;
}

function inIpv4Range(octets: number[], range: readonly [number, number, number]): boolean {
  const [first, second, bits] = range;
  const value = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0);
  const mask = (0xffff << (16 - bits)) & 0xffff;
  return (value & mask) === (((first << 8) | second) & mask);
}

function classifyIpv4(ip: string): IpClass {
  const octets = ip.split('.').map(Number);
  if (octets[0] === 127) return 'loopback';
  return IPV4_PRIVATE_RANGES.some((range) => inIpv4Range(octets, range)) ? 'private' : 'public';
}

function classifyIpv6(hextets: number[]): IpClass {
  const first = hextets[0] ?? 0;
  const isLoopback = hextets.slice(0, 7).every((h) => h === 0) && hextets[7] === 1;
  if (isLoopback) return 'loopback';
  const uniqueLocal = (first & 0xfe00) === 0xfc00; // fc00::/7
  const linkLocal = (first & 0xffc0) === 0xfe80; // fe80::/10
  return uniqueLocal || linkLocal ? 'private' : 'public';
}

/**
 * WHY a pure function: geo lookup and the anonymizer must agree on what "private" means.
 * Expects a normalized IP (see IpAnonymizer.normalize); anything invalid → 'unknown'.
 */
export function classifyIp(ip: string | null): IpClass {
  if (!ip) return 'unknown';
  if (isIPv4(ip)) return classifyIpv4(ip);
  const hextets = ipv6Hextets(ip);
  return hextets ? classifyIpv6(hextets) : 'unknown';
}

/** IPv4 → x.y.z.0 (/24); IPv6 → first 3 hextets + '::' (/48). */
export function truncateIp(ip: string): string {
  if (isIPv4(ip)) return `${ip.split('.').slice(0, 3).join('.')}.0`;
  const network = (ipv6Hextets(ip) ?? []).slice(0, IPV6_TRUNCATED_HEXTETS);
  const zeros = new Array<number>(IPV6_HEXTET_COUNT - network.length).fill(0);
  return formatIpv6([...network, ...zeros]);
}

/** WHY: the one place IP privacy policy (IP_STORAGE_MODE) is applied before storage. */
export class IpAnonymizer {
  constructor(
    private readonly mode: IpStorageMode,
    private readonly secret: string,
  ) {}

  /**
   * Returns null for anything that is not a valid IPv4/IPv6 address. IPv4-mapped IPv6 → IPv4;
   * IPv6 zone ids (`%eth0`, meaningless off-host and rejected by `inet`) are dropped and the
   * address is rewritten in canonical RFC 5952 form so ip_hash is stable across spellings.
   */
  normalize(raw: string | null | undefined): string | null {
    if (typeof raw !== 'string') return null;
    const candidate = raw.trim().toLowerCase();
    const unmapped = candidate.startsWith(IPV4_MAPPED_PREFIX)
      ? candidate.slice(IPV4_MAPPED_PREFIX.length)
      : candidate;
    if (isIPv4(unmapped)) return unmapped;
    if (isIP(candidate) !== 6) return null;
    const hextets = ipv6Hextets(candidate.replace(IPV6_ZONE, ''));
    return hextets ? formatIpv6(hextets) : null;
  }

  classify(ip: string | null): IpClass {
    return classifyIp(this.normalize(ip));
  }

  anonymize(ip: string | null): AnonymizedIp {
    const normalized = this.normalize(ip);
    if (!normalized) return { ip: null, ipHash: null, ipClass: 'unknown' };
    return {
      ip: this.applyMode(normalized),
      ipHash: createHmac('sha256', this.secret).update(normalized, 'utf8').digest(),
      ipClass: classifyIp(normalized),
    };
  }

  private applyMode(ip: string): string | null {
    switch (this.mode) {
      case 'full':
        return ip;
      case 'truncated':
        return truncateIp(ip);
      case 'hashed':
        return null;
    }
  }
}
