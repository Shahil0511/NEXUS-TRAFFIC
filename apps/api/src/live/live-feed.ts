/**
 * Entry point from ingest into the real-time layer: receives ONLY committed, non-duplicate rows.
 * S1: no-op placeholder with the final signature; S4 implements the live window + broadcaster.
 */
import type { ApiRequestInsert, WebEventInsert } from '../domain/inserts';
import type { AppRow } from '../domain/rows';

export class LiveFeed {
  recordApiRequests(app: AppRow, rows: readonly ApiRequestInsert[]): void {
    void app;
    void rows;
  }

  recordWebEvents(app: AppRow, rows: readonly WebEventInsert[]): void {
    void app;
    void rows;
  }
}
