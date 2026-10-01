/**
 * Anything that can run a query: a Pool or a checked-out PoolClient (inside a transaction).
 * Every repository method takes an optional trailing `exec?: Executor`; transactions are opened
 * ONLY in services (via withTransaction) and the client is passed down.
 */
import type { PoolClient } from 'pg';

export type Executor = Pick<PoolClient, 'query'>;
