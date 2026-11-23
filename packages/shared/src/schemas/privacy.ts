/**
 * Query schemas of ROUTES.privacy.* (admin-only).
 */
import { z } from 'zod';

import { userKeySchema } from './analytics';
import { pageQueryShape } from './common';

/**
 * GET ROUTES.privacy.accessLog — newest first, keyset-paged (`cursor`, `limit`), optionally only
 * the rows about one person (`userKey`, the opaque hex key: never an email in a URL).
 */
export const privacyAccessLogQuerySchema = z.object({
  ...pageQueryShape,
  userKey: userKeySchema.optional(),
});
export type PrivacyAccessLogQuery = z.infer<typeof privacyAccessLogQuerySchema>;
