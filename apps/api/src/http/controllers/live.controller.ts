/**
 * ROUTES.live.* — the Live page's REST backfill (the stream itself is Socket.io, see src/socket.ts).
 */
import { liveSnapshotQuerySchema } from '@nexus/shared';
import type { RequestHandler } from 'express';

import type { LiveService } from '../../services/live.service';
import { CACHE_CONTROL_HEADER, DASHBOARD_LIVE_CACHE } from '../cache-control';
import { requireViewer, validQuery } from '../request-accessors';

/** WHY: thin HTTP adapter — reads validated input, calls the same-named service method. */
export class LiveController {
  constructor(private readonly live: LiveService) {}

  /** @see ../../services/live.service.ts LiveService.snapshot */
  snapshot: RequestHandler = async (_req, res) => {
    const viewer = requireViewer(res);
    const body = await this.live.snapshot(validQuery(res, liveSnapshotQuerySchema), viewer);
    res.setHeader(CACHE_CONTROL_HEADER, DASHBOARD_LIVE_CACHE);
    res.json(body);
  };
}
