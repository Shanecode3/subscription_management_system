import fs from 'fs';
import path from 'path';
import { closePool, pool } from './pool';
import { logger } from '../utils/logger';

function resolveSchemaPath(): string {
  const candidates = [
    path.resolve(__dirname, 'schema.sql'), // dist/db when built
    path.resolve(process.cwd(), 'src/db/schema.sql'), // tsx from server/
    path.resolve(__dirname, '../../src/db/schema.sql'),
  ];

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`Could not locate schema.sql. Looked in:\n${candidates.join('\n')}`);
  }
  return found;
}

async function main(): Promise<void> {
  const schemaPath = resolveSchemaPath();
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  logger.info(`Applying schema from ${schemaPath}`);
  await pool.query(schemaSql);

  const tables = await pool.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );

  const indexes = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM pg_indexes WHERE schemaname = 'public'`,
  );

  logger.info(`Schema applied: ${tables.rowCount} tables, ${indexes.rows[0]?.count ?? '0'} indexes.`);
  console.log(`Tables: ${tables.rows.map((row) => row.table_name).join(', ')}`);
}

main()
  .catch((error: unknown) => {
    logger.error('Schema initialisation failed', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
