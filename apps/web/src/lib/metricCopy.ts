/**
 * Plain-language definitions of every number the dashboard shows.
 *
 * WHY ONE RECORD: the same metric appears on several pages (p95 on Overview, Applications, API
 * Routes, route detail, Live…). Writing the explanation once keeps every (i) tooltip saying the
 * same thing, and the definitions here MUST match what the API computes (see the DTO doc
 * comments in packages/shared/src/dto/*). Change the API meaning → change the copy here.
 */

import {
  COVERAGE_MIN_EVENTS,
  COVERAGE_TARGET_RATIO,
  RELEASE_COVERAGE_TARGET,
  RETURNING_DEVICE_LOOKBACK_MS,
} from '@nexus/shared';

import { navLabel } from './nav';

/** One metric's explanation: a name, a one-line gist and the detail a curious user wants. */
export interface MetricCopy {
  /** The metric's name in words, e.g. "p95 latency". */
  label: string;
  /** One sentence: what the number IS. */
  short: string;
  /** One or two sentences: how to read it / what it excludes. */
  long: string;
}

/**
 * Below this share (%) an integration-quality metric (identified / linked) is flagged amber — the
 * SAME threshold the API's integration level uses (COVERAGE_TARGET_RATIO, ADR 0013).
 */
export const COVERAGE_WARN_PCT = COVERAGE_TARGET_RATIO * 100;

const DAY_MS = 86_400_000;
const RELEASE_TARGET_PCT = RELEASE_COVERAGE_TARGET * 100;
/** The new-vs-returning look-back in days (RETURNING_DEVICE_LOOKBACK_MS), for every device copy. */
export const RETURNING_LOOKBACK_DAYS = Math.round(RETURNING_DEVICE_LOOKBACK_MS / DAY_MS);

export const METRIC_COPY = {
  // ─── API traffic ───────────────────────────────────────────────────────────
  requests: {
    label: 'API calls',
    short: 'How many backend API calls the apps reported in this time range.',
    long: 'One API call = one call from a browser or service to an app’s server, counted once whatever its result.',
  },
  errorRate: {
    label: 'Error rate',
    short: 'The share of API calls that failed (HTTP status 400 or higher).',
    long: '4xx = client errors (bad input, not signed in, not found); 5xx = server errors (the app itself broke). 5xx usually need a fix first.',
  },
  errors4xx: {
    label: 'Client errors (4xx)',
    short:
      'Calls the app refused because of the request: bad input, not signed in, no access, not found.',
    long: 'Often expected (an expired login, a typo in a search). A sudden rise can still point to a broken screen sending bad requests.',
  },
  errors5xx: {
    label: 'Server errors (5xx)',
    short: 'Calls that failed because the app’s server broke (crash, timeout, database down).',
    long: 'These are never the user’s fault — every 5xx is worth looking at.',
  },
  failedRequests: {
    label: 'Failed requests',
    short: 'API calls that ended with HTTP status 400 or higher (4xx + 5xx).',
    long: 'The error rate is this number divided by all requests.',
  },
  p50: {
    label: 'p50 latency (median)',
    short: 'Half of the calls were faster than this, half slower.',
    long: 'The “typical” response time. Streaming calls are excluded because they stay open on purpose.',
  },
  p95: {
    label: 'p95 latency',
    short: '95 % of calls were faster than this; the slowest 5 % took longer.',
    long: 'Shows the slowness real users notice, which an average hides. Streaming calls are excluded.',
  },
  p99: {
    label: 'p99 latency',
    short: '99 % of calls were faster than this; only the slowest 1 % took longer.',
    long: 'The worst-case experience. Very sensitive to a few outliers, so read it next to p95.',
  },
  avgLatency: {
    label: 'Average latency',
    short: 'Total response time divided by the number of calls.',
    long: 'A few very slow calls pull it up, so prefer p50 for “typical” and p95 for “slow”.',
  },
  // ─── Browser usage ─────────────────────────────────────────────────────────
  pageViews: {
    label: 'Page views',
    short: 'How many times a page was opened in a browser, including in-app navigation.',
    long: 'Reloading or coming back to a page counts again; one person can make many page views.',
  },
  sessions: {
    label: 'Visits',
    short:
      'Browser visits (sessions): one browser tab’s activity until it is closed or idle for 30 minutes.',
    long: 'Two tabs open at once are two visits. A visit is not a login — one person can have many.',
  },
  visibleTime: {
    label: 'Visible time',
    short: 'How long the page was actually on screen (the tab in front).',
    long: 'Time in a background tab or a minimised window is not counted. One stretch without a tick, for example a sleeping laptop, counts at most 1 minute.',
  },
  exitRate: {
    label: 'Exit rate',
    short: 'The share of visits to this page whose last page view was this page.',
    long: 'High on a “done” page is normal; high on a step in the middle of a flow can mean people give up there.',
  },
  toolUses: {
    label: 'Tool uses',
    short: 'Clicks on named features (buttons marked as tools, e.g. “Export CSV”).',
    long: 'Only features an app has tagged are counted, so a low number can also mean nothing is tagged yet.',
  },
  // ─── People ────────────────────────────────────────────────────────────────
  identifiedUsers: {
    label: 'Identified users',
    short: 'Distinct people we could name with a verified identity (SSO cookie or app-attested).',
    long: `Anonymous visitors and identities claimed only by the browser are not counted. Same definition as the ${navLabel('users')} page.`,
  },
  uniqueUsers: {
    label: 'Users',
    short: 'Distinct verified people who used this in the time range.',
    long: 'Each person counts once however often they came back. Anonymous traffic is not included.',
  },
  usersAffected: {
    label: 'Users affected',
    short: 'Distinct verified people who got at least one failed request.',
    long: 'Tells you how many people a failure actually hurt — 1,000 errors for one user differ from 1,000 users with one error each.',
  },
  activeUsersNow: {
    label: 'Active users now',
    short: 'People (or anonymous sessions) seen in the last 5 minutes.',
    long: 'Ignores the selected time range — it is always “right now”.',
  },
  onlineNow: {
    label: 'Online now',
    short: 'People active in the last 5 minutes: verified users plus anonymous browser sessions.',
    long: 'Refreshed every 15 s and independent of the selected time range. Someone active in two apps counts in each.',
  },
  dau: {
    label: 'Daily active users',
    short: 'Distinct verified users per calendar day (India time).',
    long: 'A person who comes back three times in one day counts once for that day.',
  },
  wau: {
    label: 'Weekly active users',
    short: 'Distinct verified users in the 7 days ending where the selected range ends.',
    long: 'Not the sum of the daily numbers: someone active every day still counts once.',
  },
  mau: {
    label: 'Monthly active users',
    short: 'Distinct verified users in the 30 days ending where the selected range ends.',
    long: 'Compare with weekly active users: close values mean most people use the apps every week.',
  },
  // ─── One person, per day ─────────────────────────────────────────────────────
  activeTime: {
    label: 'Tab visible time',
    short: 'How long an app page was on screen in a front tab, added up over the day (India time).',
    long: 'It is not keyboard or mouse use: a tab left open keeps counting and two visible tabs both count. One stretch without a tick (a sleeping laptop) counts at most 1 minute.',
  },
  firstActivity: {
    label: 'First activity',
    short: 'The earliest recorded API call or browser event of the day, India time.',
    long: 'It is the first thing the apps recorded, not a sign-in time.',
  },
  lastActivity: {
    label: 'Last activity',
    short: 'The latest recorded API call or browser event of the day, India time.',
    long: 'It is the last thing the apps recorded, not a sign-out time.',
  },
  // ─── One person, over the selected range (People list) ───────────────────────
  firstActivityInRange: {
    label: 'First activity',
    short: 'The earliest recorded API call or browser event in the selected range.',
    long: 'It is the first thing the apps recorded, not a sign-in time.',
  },
  lastActivityInRange: {
    label: 'Last activity',
    short: 'The latest recorded API call or browser event in the selected range.',
    long: 'It is the last thing the apps recorded, not a sign-out time.',
  },
  daySpan: {
    label: 'First – last activity',
    short:
      'The earliest and latest API call or browser event of the day, India time, marked on a 00:00 to 24:00 bar.',
    long: 'They are not sign-in or sign-out times. Today is not over yet, so its last activity is “so far”.',
  },
  daysActive: {
    label: 'Active days',
    short:
      'Calendar days (India time) in the selected range with at least one API call or browser event.',
    long: 'Days without any activity are not listed and do not count in the averages.',
  },
  dayApps: {
    label: 'Apps',
    short:
      'Each app used that day, India time: how long a page of it was on screen in a front tab, and its first and last recorded event.',
    long: 'Apps without the browser tracker show no time. They are listed in the order they were first used that day.',
  },
  dayCounts: {
    label: 'Pages and calls',
    short: 'Page views, feature uses and API calls of the day, India time.',
    long: 'Failed counts the API calls answered with HTTP status 400 or higher.',
  },
  dayVisits: {
    label: 'Visits',
    short:
      'Browser visits of the day: one browser tab’s activity until it is closed or idle for 30 minutes.',
    long: 'The number opens the Visits page for this person and this day. API calls alone open no visit.',
  },
  timeInApp: {
    label: 'Time in app',
    short:
      'How long at least one app page was on screen in a front tab. Tabs open at the same time count once.',
    long: 'It is not keyboard or mouse use. One stretch without a tick (a sleeping laptop) counts at most 1 minute.',
  },
  activityBlock: {
    label: 'Activity blocks',
    short: 'Stretches of browser events of the day in which every break is shorter than 5 minutes.',
    long: 'Length is end minus start of one block; lengths are not added up. API calls alone start no block.',
  },
  requestsOutsideBlocks: {
    label: 'API calls outside these blocks',
    short: 'API calls of the day made while no browser event was near.',
    long: 'Apps that call the server in the background, or without the browser tracker, add them with no page on screen.',
  },
  featureUses: {
    label: 'Feature uses',
    short: 'How many times a feature (tool) of an app was used, from the browser tracker.',
    long: 'A feature used twice counts twice.',
  },
  usualActivityHours: {
    label: 'Usual activity hours',
    short:
      'In which hours of each weekday (India time) any activity was recorded, over the last 7 or 30 days.',
    long: 'A darker cell means activity on more of those weekdays in that hour. These are not sign-in or sign-out times.',
  },
  // ─── Devices (browser) ──────────────────────────────────────────────────────
  devices: {
    label: 'Devices',
    short: 'Distinct browsers (device + browser profile) that opened a page in this time range.',
    long: 'Counted by the tracker’s anonymous device id: one person on a laptop and a phone counts twice, and a private window counts as a new device.',
  },
  newDevices: {
    label: 'New devices',
    short: `Devices in this time range that had not opened a page in the ${RETURNING_LOOKBACK_DAYS} days before it.`,
    long: `The look-back is bounded: a device last seen more than ${RETURNING_LOOKBACK_DAYS} days earlier counts as new again.`,
  },
  returningDevices: {
    label: 'Returning devices',
    short: `Devices that also opened a page in the ${RETURNING_LOOKBACK_DAYS} days before this time range.`,
    long: 'A high share means people come back; a low one means mostly first visits (or cleared browsers).',
  },
  breakdownShare: {
    label: 'Share',
    short: 'This value’s share of all counted events in the time range.',
    long: 'The share is of every event, not only the listed top values, so the list can add up to less than 100 %. “Not sent” means the event had no value.',
  },
  // ─── Integration quality ───────────────────────────────────────────────────
  identifiedPct: {
    label: 'Identified %',
    short:
      'The share of events (API calls and browser events combined) that carry a verified user.',
    long: `Low means people are missing from the ${navLabel('users')} pages. The ${navLabel('integration')} page shows it per source. Below ${COVERAGE_WARN_PCT} % is highlighted.`,
  },
  identityCoverage: {
    label: 'Identified (per source)',
    short: 'The share of this source’s events that carry a verified user.',
    long: `Per source here; the ${navLabel('applications')} page combines both sources. Below ${COVERAGE_WARN_PCT} % is highlighted; under ${COVERAGE_MIN_EVENTS} events there is no verdict.`,
  },
  linkingCoverage: {
    label: 'Linked API calls',
    short:
      'The share of linkable API calls (http calls from desktop, mobile and tablet browsers) that carry the tracker’s session header.',
    long: `“Page view” counts the calls that also name their page view. Below ${COVERAGE_WARN_PCT} % is highlighted.`,
  },
  releaseCoverage: {
    label: 'Release tagged',
    short: 'The share of events that carry a release (build or version) tag.',
    long: `At ${RELEASE_TARGET_PCT} % or more per source, a deploy shows up in the numbers. Under ${COVERAGE_MIN_EVENTS} events there is no verdict.`,
  },
  integrationLevel: {
    label: 'Integration level',
    short:
      'How far an app’s wiring has got: not connected, partial, connected or fully integrated.',
    long: `Fully integrated = both sources send, ${COVERAGE_WARN_PCT} % of API calls linked and of browser events identified, ${RELEASE_TARGET_PCT} % release-tagged per source, no key, PII or disabled-app warning.`,
  },
  sendingData: {
    label: 'Apps sending data',
    short: 'Registered apps that sent at least one API call or browser event in this time range.',
    long: `A registered app that stays silent usually has a broken or undeployed integration. See ${navLabel('integration')}.`,
  },
  linkedPct: {
    label: 'Linked %',
    short:
      'The share of browser API calls (http from desktop, mobile and tablet) we can tie to the browser session that made them.',
    long: `SSR, server-to-server calls, bots and downloads cannot link and are left out. Below ${COVERAGE_WARN_PCT} % is highlighted.`,
  },
} as const satisfies Record<string, MetricCopy>;

/** Every metric that has an explanation. */
export type MetricKey = keyof typeof METRIC_COPY;

/** The tooltip text for a metric: what it is, then how to read it. */
export function metricInfo(key: MetricKey): string {
  const copy: MetricCopy = METRIC_COPY[key];
  return `${copy.short} ${copy.long}`;
}
