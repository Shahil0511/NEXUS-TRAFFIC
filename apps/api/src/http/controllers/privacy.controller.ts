/**
 * ROUTES.privacy.* — the Privacy & access page (admin-only: requireAdmin in the route table).
 */
import { privacyAccessLogQuerySchema } from '@nexus/shared';
import type { RequestHandler } from 'express';

import type { PrivacyService } from '../../services/privacy.service';
import { CACHE_CONTROL_HEADER, NO_STORE_CACHE } from '../cache-control';
import { requireViewer, validQuery } from '../request-accessors';

/** WHY: thin HTTP adapter — reads validated input, calls the same-named service method. */
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  /**
   * no-store: the newest opens must show at once, and the log is never kept by a browser cache.
   * @see ../../services/privacy.service.ts PrivacyService.accessLog
   */
  accessLog: RequestHandler = async (_req, res) => {
    requireViewer(res);
    const body = await this.privacy.accessLog(validQuery(res, privacyAccessLogQuerySchema));
    res.setHeader(CACHE_CONTROL_HEADER, NO_STORE_CACHE);
    res.json(body);
  };
}
