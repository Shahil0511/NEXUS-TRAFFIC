/**
 * GET ROUTES.geo.countries item (WindowedListDto). Country = ISO-3166 alpha-2, or null when
 * unknown/private IP. `requests` = API calls, `pageViews` = browser page views, `users` = distinct
 * verified users.
 */
export interface GeoCountryDto {
  country: string | null;
  requests: number;
  pageViews: number;
  users: number;
}

/**
 * GET ROUTES.geo.cities item (WindowedListDto). lat/lon are city centroids (approximate, from
 * GeoLite2) — the UI labels the table "approximate".
 */
export interface GeoCityDto {
  country: string | null;
  region: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
  requests: number;
  pageViews: number;
  users: number;
}
