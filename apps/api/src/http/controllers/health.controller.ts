/**
 * ROUTES.health.* — used by Docker healthchecks and deploy.sh. Never cached.
 */
import type { RequestHandler } from 'express';

import type { HealthService } from '../../services/health.service';

export class HealthController {
  constructor(private readonly health: HealthService) {}

  live: RequestHandler = (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(this.health.live());
  };

  ready: RequestHandler = async (_req, res) => {
    const report = await this.health.ready();
    res.setHeader('Cache-Control', 'no-store');
    res.status(report.status === 'ok' ? 200 : 503).json(report);
  };
}
