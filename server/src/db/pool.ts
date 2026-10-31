import pg, { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * PostgreSQL DATE columns come back as JS Date objects anchored to local
 * midnight. Serialising one with toISOString() shifts the calendar day in any
 * non-UTC timezone (IST is +05:30), so a plan starting 2026-01-01 would be sent
 * as 2025-12-31T18:30:00Z. Keeping the raw 'YYYY-MM-DD' text removes the whole
 * class of off-by-one bugs around billing and availability dates.
 */
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);

/**
 * A single pool for the whole process. Creating a Pool per request is the most
 * common way to exhaust PostgreSQL connections under load.
 */
export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: 'brightloop-api',
});

pool.on('error', (error) => {
  // An idle client failed (e.g. server restart). Log and let the pool recycle it.
  logger.error('Unexpected PostgreSQL pool error', error);
});

export function query<T extends QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params as unknown[]);
}

/** Runs `fn` inside BEGIN/COMMIT, rolling back on any thrown error. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError: unknown) => {
      logger.error('Failed to roll back transaction', rollbackError);
    });
    throw error;
  } finally {
    client.release();
  }
}

export async function isDatabaseReachable(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch (error) {
    logger.warn('Database health check failed', error instanceof Error ? error.message : error);
    return false;
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
