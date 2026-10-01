/**
 * IP → approximate location using geoip-lite's bundled GeoLite2 data (lazy-loaded on first use —
 * the data takes ~100 MB of memory). lat/lon rounded to 1 decimal (city-centroid precision).
 * Private/loopback/invalid IPs → null.
 */
import { notImplemented } from '../lib/not-implemented';

export interface GeoInfo {
  country: string | null;
  region: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
}

export class GeoIpEnricher {
  lookup(ip: string | null): GeoInfo | null {
    void ip;
    throw notImplemented('GeoIpEnricher.lookup');
  }
}
