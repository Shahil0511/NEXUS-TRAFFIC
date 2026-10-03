/**
 * Links into the PUBLIC integration guide (the page other teams read), served by the API at
 * ROUTES.docs.home under the same origin: `/traffic/api/docs/`.
 *
 * WHY here: the Integration and Apps pages both point teams at the chapter that fixes a problem.
 * The anchors are the chapter ids scripts/build-docs.ts derives from the file names in
 * docs/integration/ (`10-verify.md` → `#10-verify`) — constants, never ingested data.
 */
import { ROUTES } from '@nexus/shared';

import { API_PREFIX } from './api';

/** `/traffic/api/docs/` — absolute path; a plain <a>, not a Next <Link> (the API serves it). */
export const GUIDE_URL = `${API_PREFIX}${ROUTES.docs.home.path}`;

/** Chapter ids of docs/integration/*.md that the dashboard links to. */
export const GUIDE_CHAPTERS = {
  overview: '00-overview',
  keys: '01-getting-keys',
  responses: '04-responses-retries',
  clientIp: '06-client-ip',
  recipes: '08-recipes',
  verify: '10-verify',
  troubleshooting: '11-troubleshooting',
} as const;

export type GuideChapter = keyof typeof GUIDE_CHAPTERS;

/** `/traffic/api/docs/#10-verify`, or the guide home without a chapter. */
export function guideHref(chapter?: GuideChapter): string {
  return chapter ? `${GUIDE_URL}#${GUIDE_CHAPTERS[chapter]}` : GUIDE_URL;
}
