/**
 * Cache-Control values of dashboard responses.
 *
 * WHY: analytics responses are per-user (IP masking depends on the viewer) and change every few
 * seconds. `private` keeps shared proxies from storing them; a short max-age lets the browser reuse
 * a response when React Query refetches the same key on focus/remount.
 */
export const CACHE_CONTROL_HEADER = 'Cache-Control';
export const DASHBOARD_ANALYTICS_CACHE = 'private, max-age=15';
