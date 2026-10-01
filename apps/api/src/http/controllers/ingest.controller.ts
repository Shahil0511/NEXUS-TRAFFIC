/**
 * ROUTES.ingest.* — the public contract other teams call.
 * server: 202 IngestResultDto (`?dryRun=1` validates without writing). verify: 200 VerifyResponseDto.
 */
import type { RequestHandler } from 'express';

import type { Clock } from '../../lib/clock';
import { notImplemented } from '../../lib/not-implemented';
import type { IngestService } from '../../services/ingest.service';

export class IngestController {
  constructor(
    private readonly ingest: IngestService,
    private readonly clock: Clock,
  ) {}

  server: RequestHandler = async (_req, _res) => {
    void this.ingest;
    void this.clock;
    throw notImplemented('IngestController.server');
  };

  verify: RequestHandler = (_req, _res) => {
    throw notImplemented('IngestController.verify');
  };
}
