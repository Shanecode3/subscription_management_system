import type { PoolClient, QueryResultRow } from 'pg';
import { query } from '../db/pool';
import type { UserRole } from '../utils/jwt';

export interface UserRow extends QueryResultRow {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  phone: string | null;
  company_name: string | null;
  address: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/** Public projection — deliberately excludes password_hash and reset_token. */
export interface PublicUserRow extends QueryResultRow {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  phone: string | null;
  company_name: string | null;
  address: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface NewUserInput {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  phone?: string | null;
  companyName?: string | null;
  address?: string | null;
}

const PUBLIC_COLUMNS = `id, name, email, role, phone, company_name, address, is_active, created_at, updated_at`;

const PRIVATE_COLUMNS = `${PUBLIC_COLUMNS}, password_hash`;

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const result = await query<UserRow>(
    `SELECT ${PRIVATE_COLUMNS} FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email],
  );
  return result.rows[0] ?? null;
}

export async function findUserById(id: number): Promise<UserRow | null> {
  const result = await query<UserRow>(`SELECT ${PRIVATE_COLUMNS} FROM users WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function findPublicUserById(id: number): Promise<PublicUserRow | null> {
  const result = await query<PublicUserRow>(
    `SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/**
 * `client` is optional so callers that need the insert to commit atomically with
 * other writes (for example an audit row) can pass their transaction handle.
 */
export async function insertUser(
  input: NewUserInput,
  client?: PoolClient,
): Promise<PublicUserRow> {
  const sql = `
    INSERT INTO users (name, email, password_hash, role, phone, company_name, address)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING ${PUBLIC_COLUMNS}
  `;
  const params = [
    input.name,
    input.email.toLowerCase(),
    input.passwordHash,
    input.role,
    input.phone ?? null,
    input.companyName ?? null,
    input.address ?? null,
  ];

  const result = client
    ? await client.query<PublicUserRow>(sql, params)
    : await query<PublicUserRow>(sql, params);

  const row = result.rows[0];
  if (!row) throw new Error('User insert returned no row.');
  return row;
}

export async function listUsers(): Promise<PublicUserRow[]> {
  const result = await query<PublicUserRow>(
    `SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY created_at DESC, id DESC`,
  );
  return result.rows;
}

/** Stores the SHA-256 hash of the reset token, never the token itself. */
export async function savePasswordResetToken(
  userId: number,
  tokenHash: string,
  expiresAt: Date,
): Promise<void> {
  await query(
    `UPDATE users
        SET reset_token = $2, reset_token_expiry = $3
      WHERE id = $1`,
    [userId, tokenHash, expiresAt],
  );
}

export async function findUserByResetToken(tokenHash: string): Promise<UserRow | null> {
  const result = await query<UserRow>(
    `SELECT ${PRIVATE_COLUMNS}
       FROM users
      WHERE reset_token = $1
        AND reset_token_expiry > NOW()
        AND is_active = TRUE
      LIMIT 1`,
    [tokenHash],
  );
  return result.rows[0] ?? null;
}

export async function updatePasswordAndClearToken(
  userId: number,
  passwordHash: string,
): Promise<void> {
  await query(
    `UPDATE users
        SET password_hash = $2,
            reset_token = NULL,
            reset_token_expiry = NULL
      WHERE id = $1`,
    [userId, passwordHash],
  );
}
