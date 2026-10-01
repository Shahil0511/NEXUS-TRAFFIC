import type { IdentitySource } from '../constants/traffic';

/** GET ROUTES.users.list item. `userKey` is an opaque HMAC of the email — safe in URLs. */
export interface UserSummaryDto {
  userKey: string;
  email: string;
  lastSeenAt: string;
  requests: number;
  pageViews: number;
  sessions: number;
  apps: string[];
}

/** GET ROUTES.users.profile */
export interface UserProfileDto {
  summary: UserSummaryDto;
  firstSeenAt: string;
  failedRequests: number;
  topTools: Array<{ app: string; tool: string; uses: number }>;
  topPages: Array<{ app: string; pathTemplate: string; views: number }>;
  countries: string[];
}

export const TIMELINE_ITEM_KIND_VALUES = [
  'api',
  'page_view',
  'page_time',
  'tool_use',
  'custom',
] as const;
export type TimelineItemKind = (typeof TIMELINE_ITEM_KIND_VALUES)[number];

/** GET ROUTES.users.timeline item — API calls and browser events merged by time. */
export interface TimelineItemDto {
  eventId: string;
  occurredAt: string;
  kind: TimelineItemKind;
  app: string;
  path: string;
  sessionId: string | null;
  identitySource: IdentitySource;
  method: string | null;
  status: number | null;
  durationMs: number | null;
  tool: string | null;
  visibleMs: number | null;
}
