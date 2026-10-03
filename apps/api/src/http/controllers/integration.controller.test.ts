import { ROUTES, type IntegrationHealthDto } from '@nexus/shared';
import express, { type Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { recordingLogger } from '../../../test/fixtures/recording-logger';
import type { Viewer } from '../../domain/viewer';
import type { IntegrationService } from '../../services/integration.service';
import { DASHBOARD_ANALYTICS_CACHE } from '../cache-control';
import { errorHandlerMiddleware } from '../middleware/error-handler.middleware';
import { IntegrationController } from './integration.controller';

const VIEWER: Viewer = { email: 'viewer@libas.in', isAdmin: false };
const HEALTH: IntegrationHealthDto = {
  from: '2026-09-30T10:00:00.000Z',
  to: '2026-10-01T10:00:00.000Z',
  apps: [],
};

class FakeIntegration implements Pick<IntegrationService, 'health'> {
  calls = 0;
  async health(): Promise<IntegrationHealthDto> {
    this.calls += 1;
    return HEALTH;
  }
}

function buildApp(service: FakeIntegration, viewer: Viewer | null): Express {
  const ctl = new IntegrationController(service as unknown as IntegrationService);
  const app = express();
  app.use((_req, res, next) => {
    if (viewer) res.locals.viewer = viewer;
    next();
  });
  app.get(ROUTES.integration.health.path, ctl.health);
  app.use(errorHandlerMiddleware(recordingLogger().logger));
  return app;
}

describe('IntegrationController.health', () => {
  it('→ 200 with the service DTO, private short cache', async () => {
    const service = new FakeIntegration();
    const res = await request(buildApp(service, VIEWER)).get(ROUTES.integration.health.path);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(HEALTH);
    expect(res.headers['cache-control']).toBe(DASHBOARD_ANALYTICS_CACHE);
    expect(service.calls).toBe(1);
  });

  it('never calls the service without a viewer (the SSO middleware did not run)', async () => {
    const service = new FakeIntegration();
    const res = await request(buildApp(service, null)).get(ROUTES.integration.health.path);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(service.calls).toBe(0);
  });
});
