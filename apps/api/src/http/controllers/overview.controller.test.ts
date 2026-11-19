import {
  breakdownOverviewQuerySchema,
  devicesOverviewQuerySchema,
  ERROR_CODES,
  ROUTES,
  type BreakdownDto,
  type BreakdownOverviewQuery,
  type DeviceReturnDto,
  type DevicesOverviewQuery,
} from '@nexus/shared';
import express, { type Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { recordingLogger } from '../../../test/fixtures/recording-logger';
import type { Viewer } from '../../domain/viewer';
import type { OverviewService } from '../../services/overview.service';
import { DASHBOARD_ANALYTICS_CACHE } from '../cache-control';
import { errorHandlerMiddleware } from '../middleware/error-handler.middleware';
import { validateQuery } from '../middleware/validate.middleware';
import { OverviewController } from './overview.controller';

const VIEWER: Viewer = { email: 'viewer@libas.in', isAdmin: false };
const WINDOW = {
  from: '2026-09-30T10:00:00.000Z',
  to: '2026-10-01T10:00:00.000Z',
  grain: 'hour' as const,
};

class FakeOverview implements Pick<OverviewService, 'breakdown' | 'devices'> {
  readonly calls: unknown[][] = [];

  async breakdown(query: BreakdownOverviewQuery): Promise<BreakdownDto> {
    this.calls.push(['breakdown', query]);
    return {
      window: WINDOW,
      source: query.source,
      dimension: query.dimension,
      total: 4,
      items: [{ value: 'Asia/Kolkata', events: 4, share: 1 }],
    };
  }

  async devices(query: DevicesOverviewQuery): Promise<DeviceReturnDto> {
    this.calls.push(['devices', query]);
    return {
      window: WINDOW,
      lookbackFrom: '2026-08-31T10:00:00.000Z',
      devices: 3,
      newDevices: 1,
      returningDevices: 2,
    };
  }
}

/** Wired like the real route table: viewer → validateQuery → controller → error handler. */
function buildApp(service: FakeOverview): Express {
  const ctl = new OverviewController(service as unknown as OverviewService);
  const app = express();
  app.use((_req, res, next) => {
    res.locals.viewer = VIEWER;
    next();
  });
  app.get(
    ROUTES.overview.breakdown.path,
    validateQuery(breakdownOverviewQuerySchema),
    ctl.breakdown,
  );
  app.get(ROUTES.overview.devices.path, validateQuery(devicesOverviewQuerySchema), ctl.devices);
  app.use(errorHandlerMiddleware(recordingLogger().logger));
  return app;
}

describe('OverviewController.breakdown', () => {
  it('→ 200 with the service DTO, zod defaults applied, private short cache', async () => {
    const service = new FakeOverview();
    const res = await request(buildApp(service)).get(
      `${ROUTES.overview.breakdown.path}?dimension=client_tz&env=staging`,
    );
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe(DASHBOARD_ANALYTICS_CACHE);
    expect(res.body).toMatchObject({ source: 'browser', dimension: 'client_tz', total: 4 });
    expect(service.calls[0]).toEqual([
      'breakdown',
      { range: '24h', env: 'staging', source: 'browser', dimension: 'client_tz', limit: 10 },
    ]);
  });

  it('→ 400 for a dimension api_requests does not have (source=server) or an unknown env', async () => {
    const service = new FakeOverview();
    const app = buildApp(service);
    for (const query of ['source=server&dimension=nav', 'dimension=os&env=qa']) {
      const res = await request(app).get(`${ROUTES.overview.breakdown.path}?${query}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    }
    expect(service.calls).toEqual([]);
  });
});

describe('OverviewController.devices', () => {
  it('→ 200 with new vs returning devices, private short cache', async () => {
    const service = new FakeOverview();
    const res = await request(buildApp(service)).get(`${ROUTES.overview.devices.path}?range=7d`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe(DASHBOARD_ANALYTICS_CACHE);
    expect(res.body).toMatchObject({ devices: 3, newDevices: 1, returningDevices: 2 });
    expect(service.calls[0]).toEqual(['devices', { range: '7d' }]);
  });
});
