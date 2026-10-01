/**
 * ROUTES.me.get — the signed-in dashboard user (the web shell uses it to show admin actions).
 */
import type { MeDto } from '@nexus/shared';
import type { RequestHandler } from 'express';

import { requireViewer } from '../request-accessors';

export class MeController {
  get: RequestHandler = (_req, res) => {
    const viewer = requireViewer(res);
    const body: MeDto = { email: viewer.email, isAdmin: viewer.isAdmin };
    res.json(body);
  };
}
