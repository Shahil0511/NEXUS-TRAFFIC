import type { Lookup } from 'geoip-lite';
import { describe, expect, it, vi } from 'vitest';

import { GeoIpEnricher, type GeoIpModule } from './geo-ip.enricher';

function lookupResult(overrides: Partial<Lookup> = {}): Lookup {
  return {
    range: [0, 0],
    country: 'IN',
    region: 'MH',
    city: 'Mumbai',
    eu: '0',
    timezone: 'Asia/Kolkata',
    ll: [19.0748, 72.8856],
    metro: 0,
    area: 20,
    ...overrides,
  };
}

function fakeGeo(result: Lookup | null) {
  const module: GeoIpModule = { lookup: vi.fn(() => result) };
  const loader = vi.fn(() => module);
  return { module, loader, enricher: new GeoIpEnricher(loader) };
}

describe('GeoIpEnricher', () => {
  it('maps country/region/city and rounds lat/lon to one decimal', () => {
    const { enricher } = fakeGeo(lookupResult());
    expect(enricher.lookup('49.36.1.1')).toEqual({
      country: 'IN',
      region: 'MH',
      city: 'Mumbai',
      lat: 19.1,
      lon: 72.9,
    });
  });

  it('turns empty strings into null', () => {
    const { enricher } = fakeGeo(lookupResult({ region: '', city: '' }));
    expect(enricher.lookup('49.36.1.1')).toMatchObject({ region: null, city: null, country: 'IN' });
  });

  it('returns null when the database has no entry', () => {
    expect(fakeGeo(null).enricher.lookup('49.36.1.1')).toBeNull();
  });

  it.each([null, '', 'not-an-ip', '10.0.0.1', '192.168.0.10', '127.0.0.1', '::1', 'fe80::1'])(
    'returns null without touching the database for %s',
    (ip) => {
      const { enricher, loader } = fakeGeo(lookupResult());
      expect(enricher.lookup(ip)).toBeNull();
      expect(loader).not.toHaveBeenCalled();
    },
  );

  it('loads the module lazily, exactly once', () => {
    const { enricher, loader, module } = fakeGeo(lookupResult());
    expect(loader).not.toHaveBeenCalled();
    enricher.lookup('49.36.1.1');
    enricher.lookup('2401:4900::1');
    expect(loader).toHaveBeenCalledTimes(1);
    expect(module.lookup).toHaveBeenCalledTimes(2);
  });
});
