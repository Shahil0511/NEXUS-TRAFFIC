/**
 * ROUTES.ingest.* — the public contract other teams call.
 * server: 202 IngestResultDto (`?dryRun=1` validates without writing). verify: 200 VerifyResponseDto.
 * Both responses carry the X-Nexus-Contract header so SDKs can detect a contract mismatch.
 */
import {
  INGEST_CONTRACT_VERSION,
  INGEST_HEADERS,
  serverIngestEnvelopeSchema,
  type ServerIngestEnvelope,
} from '@nexus/shared';
import type { Request, RequestHandler, Response } from 'express';

import type { IngestContext } from '../../domain/viewer';
import type { Clock } from '../../lib/clock';
import type { IngestService } from '../../services/ingest.service';
import { requireIngest, validBody } from '../request-accessors';

const DRY_RUN_FLAG = '1';

/** X-Nexus-SDK header wins; else the envelope's `sdk` as `name@version`. */
function sdkOf(req: Request, envelope?: ServerIngestEnvelope): string | null {
  const header = req.get(INGEST_HEADERS.sdk);
  if (header) return header;
  return envelope?.sdk ? `${envelope.sdk.name}@${envelope.sdk.version}` : null;
}

function setContractHeader(res: Response): void {
  res.setHeader(INGEST_HEADERS.contract, String(INGEST_CONTRACT_VERSION));
}

/** WHY: thin HTTP adapter — reads validated input + auth context, delegates to IngestService. */
export class IngestController {
  constructor(
    private readonly ingest: IngestService,
    private readonly clock: Clock,
  ) {}

  server: RequestHandler = async (req, res) => {
    const envelope = validBody(res, serverIngestEnvelopeSchema);
    const ctx = this.contextOf(req, res, envelope);
    // Raw read only — NEVER assign req.query (an Express 5 getter).
    const dryRun = req.query.dryRun === DRY_RUN_FLAG;
    const result = await this.ingest.ingestServerEvents(envelope, ctx, { dryRun });
    setContractHeader(res);
    res.status(202).json(result);
  };

  verify: RequestHandler = (req, res) => {
    const result = this.ingest.verify(this.contextOf(req, res));
    setContractHeader(res);
    res.status(200).json(result);
  };

  private contextOf(req: Request, res: Response, envelope?: ServerIngestEnvelope): IngestContext {
    const { app, key } = requireIngest(res);
    return { app, key, receivedAt: this.clock.now(), sdk: sdkOf(req, envelope) };
  }
}
