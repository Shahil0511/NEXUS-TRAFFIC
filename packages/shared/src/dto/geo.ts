/** GET ROUTES.geo.countries item. Country = ISO-3166 alpha-2, or null when unknown/private IP. */
export interface GeoCountryDto {
  country: string | null;
  requests: number;
  pageViews: number;
  users: number;
}

/** GET ROUTES.geo.cities item. lat/lon are city centroids (approximate, from GeoLite2). */
export interface GeoCityDto {
  country: string | null;
  region: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
  requests: number;
  users: number;
}
