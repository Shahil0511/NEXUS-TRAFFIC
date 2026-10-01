/**
 * Liveness (process up) and readiness (DB reachable, schema current, next month's partitions exist).
 */
import type { SchemaGuard } from '../db/migration-runner/schema-guard';
import { PARTITIONED_TABLES } from '../db/schema';
import type { HealthRepository } from '../repositories/health.repository';
import type { PartitionRepository } from '../repositories/partition.repository';

export interface ReadinessReport {
  status: 'ok' | 'degraded';
  database: boolean;
  schemaCurrent: boolean;
  schemaAhead: boolean;
  futurePartitions: boolean;
}

export class HealthService {
  constructor(
    private readonly health: HealthRepository,
    private readonly partitions: PartitionRepository,
    private readonly schemaGuard: SchemaGuard,
  ) {}

  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  async ready(): Promise<ReadinessReport> {
    try {
      await this.health.ping();
    } catch {
      return { status: 'degraded', database: false, schemaCurrent: false, schemaAhead: false, futurePartitions: false };
    }
    const schema = await this.schemaGuard.check();
    const futureCounts = await Promise.all(PARTITIONED_TABLES.map((t) => this.partitions.countFuture(t)));
    const schemaCurrent = schema.pending.length === 0 && schema.drifted.length === 0;
    const futurePartitions = futureCounts.every((n) => n >= 1);
    return {
      status: schemaCurrent && futurePartitions ? 'ok' : 'degraded',
      database: true,
      schemaCurrent,
      schemaAhead: schema.unknownApplied.length > 0,
      futurePartitions,
    };
  }
}
