import bcrypt from 'bcryptjs';
import { env } from '../config/env';
import { closePool, pool } from './pool';
import { logger } from '../utils/logger';
import type { UserRole } from '../utils/jwt';

interface SeedAccount {
  name: string;
  email: string;
  role: UserRole;
  companyName: string | null;
  phone: string | null;
}

/** Demo password satisfies the 9+ / upper / lower / special rule. */
const SEED_PASSWORD = 'Brightloop@2026';

const SEED_ACCOUNTS: SeedAccount[] = [
  {
    name: 'Aanya Sharma',
    email: 'admin@brightloop.com',
    role: 'ADMIN',
    companyName: 'Brightloop Software',
    phone: '+91 98200 11001',
  },
  {
    name: 'Rohan Mehta',
    email: 'staff@brightloop.com',
    role: 'STAFF',
    companyName: 'Brightloop Software',
    phone: '+91 98200 11002',
  },
  {
    name: 'Priya Nair',
    email: 'customer@brightloop.com',
    role: 'CUSTOMER',
    companyName: 'Nair Retail Group',
    phone: '+91 98200 11003',
  },
];

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, env.bcryptRounds);
  let inserted = 0;

  for (const account of SEED_ACCOUNTS) {
    // ON CONFLICT with no target covers both the email constraint and the
    // case-insensitive unique index, so re-running the seed is always safe.
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, company_name, phone)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        account.name,
        account.email,
        passwordHash,
        account.role,
        account.companyName,
        account.phone,
      ],
    );
    if ((result.rowCount ?? 0) > 0) inserted += 1;
  }

  const total = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM users');

  logger.info(`Seed complete: ${inserted} new account(s), ${total.rows[0]?.count ?? '0'} user(s) total.`);
  console.log('Demo accounts (password for all three): ' + SEED_PASSWORD);
  for (const account of SEED_ACCOUNTS) {
    console.log(`  - ${account.role.padEnd(8)} ${account.email}`);
  }
}

main()
  .catch((error: unknown) => {
    logger.error('Seeding failed', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
