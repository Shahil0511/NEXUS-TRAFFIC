/**
 * Applies IP_STORAGE_MODE AFTER geo lookup:
 * - full:      store the IP as-is
 * - truncated: zero the last IPv4 octet (/24) or keep the first 48 bits of IPv6 (/48)
 * - hashed:    store no IP
 * ip_hash = HMAC-SHA256(IP_HASH_SECRET, ip) is always stored (distinct-visitor counts) when an IP exists.
 * Also classifies the IP (public / private / loopback / unknown).
 */
import type { IpClass, IpStorageMode } from '@nexus/shared';

import { notImplemented } from '../lib/not-implemented';

export interface AnonymizedIp {
  ip: string | null;
  ipHash: Buffer | null;
  ipClass: IpClass;
}

export class IpAnonymizer {
  constructor(
    private readonly mode: IpStorageMode,
    private readonly secret: string,
  ) {}

  /** Returns null for anything that is not a valid IPv4/IPv6 address. */
  normalize(raw: string | null | undefined): string | null {
    void raw;
    throw notImplemented('IpAnonymizer.normalize');
  }

  classify(ip: string | null): IpClass {
    void ip;
    throw notImplemented('IpAnonymizer.classify');
  }

  anonymize(ip: string | null): AnonymizedIp {
    void ip;
    void this.mode;
    void this.secret;
    throw notImplemented('IpAnonymizer.anonymize');
  }
}
