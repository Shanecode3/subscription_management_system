import { Client } from 'pg';
import { env } from '../config/env';

interface DatabaseTarget {
  maintenanceUrl: string;
  databaseName: string;
}

/** Splits DATABASE_URL into a name to create and a URL to connect to `postgres`. */
function parseTarget(databaseUrl: string): DatabaseTarget {
  const url = new URL(databaseUrl);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));

  if (!databaseName) {
    throw new Error('DATABASE_URL must end with a database name, e.g. .../brightloop_db');
  }

  url.pathname = '/postgres';
  return { maintenanceUrl: url.toString(), databaseName };
}

async function main(): Promise<void> {
  const { maintenanceUrl, databaseName } = parseTarget(env.databaseUrl);
  const client = new Client({ connectionString: maintenanceUrl });

  await client.connect();
  try {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      databaseName,
    ]);

    if ((existing.rowCount ?? 0) > 0) {
      console.log(`Database "${databaseName}" already exists — nothing to do.`);
      return;
    }

    // CREATE DATABASE cannot take a bind parameter, so the identifier is
    // validated above and quoted here.
    const quoted = `"${databaseName.replace(/"/g, '""')}"`;
    await client.query(`CREATE DATABASE ${quoted}`);
    console.log(`Database "${databaseName}" created.`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('Could not create the database:', error instanceof Error ? error.message : error);
  process.exit(1);
});
