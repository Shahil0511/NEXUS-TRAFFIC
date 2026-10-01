/**
 * IP → approximate location using geoip-lite's bundled GeoLite2 data (lazy-loaded on first use —
 * the data takes ~100 MB of memory). lat/lon rounded to 1 decimal (city-centroid precision).
 * Private/loopback/invalid IPs → null.
 */
import type * as GeoIpLite from 'geoip-lite';

import { classifyIp } from './ip.anonymizer';

export interface GeoInfo {
  country: string | null;
  region: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
}

/** The part of geoip-lite we use (injectable so tests never load the 100 MB database). */
export type GeoIpModule = Pick<typeof GeoIpLite, 'lookup'>;
export type GeoIpLoader = () => GeoIpModule;

/** WHY: require() at first lookup, not at import, so boot and unrelated tests stay light. */
export const loadGeoIpLite: GeoIpLoader = () => require('geoip-lite') as GeoIpModule;

function textOrNull(value: string | undefined): string | null {
  return value ? value : null;
}

function roundCoordinate(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}

/** WHY: geography without an external service; resolves from the FULL ip before anonymization. */
export class GeoIpEnricher {
  private module: GeoIpModule | null = null;

  constructor(private readonly load: GeoIpLoader = loadGeoIpLite) {}

  lookup(ip: string | null): GeoInfo | null {
    if (!ip || classifyIp(ip) !== 'public') return null;
    const hit = this.geoip().lookup(ip);
    if (!hit) return null;
    return {
      country: textOrNull(hit.country),
      region: textOrNull(hit.region),
      city: textOrNull(hit.city),
      lat: roundCoordinate(hit.ll?.[0]),
      lon: roundCoordinate(hit.ll?.[1]),
    };
  }

  private geoip(): GeoIpModule {
    this.module ??= this.load();
    return this.module;
  }
}
