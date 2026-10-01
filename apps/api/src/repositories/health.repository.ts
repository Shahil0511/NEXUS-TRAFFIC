/**
 * Liveness of the database connection.
 */
import type { Pool } from 'pg';

export class HealthRepository {
  constructor(private readonly db: Pool) {}

  async ping(): Promise<void> {
    await this.db.query('SELECT 1');
  }
}
