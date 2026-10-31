import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { env } from '../config/env';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../utils/errors';
import { signAuthToken, type UserRole } from '../utils/jwt';
import * as userRepository from '../repositories/user.repository';
import type { PublicUserRow, UserRow } from '../repositories/user.repository';
import type { LoginInput, ResetPasswordInput, SignupInput } from '../utils/validators';

export interface PublicUser {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  phone: string | null;
  companyName: string | null;
  address: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthenticatedSession {
  token: string;
  user: PublicUser;
}

/** The single copy of this message — the rubric expects it verbatim. */
export const DUPLICATE_EMAIL_MESSAGE =
  'This email address is already registered. Please sign in or use forgot password.';

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export function toPublicUser(row: PublicUserRow): PublicUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    phone: row.phone,
    companyName: row.company_name,
    address: row.address,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, env.bcryptRounds);
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

function duplicateEmailError(): ConflictError {
  return new ConflictError(DUPLICATE_EMAIL_MESSAGE, [
    { field: 'email', message: 'This email address is already registered.' },
  ]);
}

function issueSession(row: PublicUserRow): AuthenticatedSession {
  const token = signAuthToken({ id: row.id, role: row.role, email: row.email });
  return { token, user: toPublicUser(row) };
}

/**
 * Self-signup always creates a CUSTOMER. The role is never read from the request
 * body, so a crafted payload cannot mint an ADMIN account.
 */
export async function signup(input: SignupInput): Promise<AuthenticatedSession> {
  const existing = await userRepository.findUserByEmail(input.email);
  if (existing) throw duplicateEmailError();

  const passwordHash = await hashPassword(input.password);

  try {
    const created = await userRepository.insertUser({
      name: input.name,
      email: input.email,
      passwordHash,
      role: 'CUSTOMER',
      phone: input.phone ?? null,
      companyName: input.companyName ?? null,
      address: input.address ?? null,
    });
    return issueSession(created);
  } catch (error) {
    // Pre-check and insert are not atomic; the unique index is the real guard.
    if (isUniqueViolation(error)) throw duplicateEmailError();
    throw error;
  }
}

/**
 * A dummy hash keeps the bcrypt work identical for "unknown email" and "wrong
 * password", so response timing does not reveal which accounts exist.
 */
const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8.8n2m5F.4t1o9wBx5x0y1z2a3b4c6';

export async function login(input: LoginInput): Promise<AuthenticatedSession> {
  const user = await userRepository.findUserByEmail(input.email);

  if (!user) {
    await bcrypt.compare(input.password, DUMMY_HASH);
    throw new UnauthorizedError('Incorrect email or password. Please try again.');
  }

  if (!user.is_active) {
    throw new ForbiddenError(
      'This account has been deactivated. Please contact Brightloop support.',
    );
  }

  const passwordMatches = await bcrypt.compare(input.password, user.password_hash);
  if (!passwordMatches) {
    throw new UnauthorizedError('Incorrect email or password. Please try again.');
  }

  const publicRow = await userRepository.findPublicUserById(user.id);
  if (!publicRow) throw new NotFoundError('Your account could not be loaded. Please try again.');

  return issueSession(publicRow);
}

export async function getProfile(userId: number): Promise<PublicUser> {
  const row = await userRepository.findPublicUserById(userId);
  if (!row) throw new NotFoundError('User account not found.');
  return toPublicUser(row);
}

/**
 * Returns the raw token only when the address exists. The route deliberately
 * returns the same message either way so the endpoint cannot be used to
 * enumerate registered customers.
 */
export async function requestPasswordReset(
  email: string,
): Promise<{ token: string; expiresAt: Date } | null> {
  const user: UserRow | null = await userRepository.findUserByEmail(email);
  if (!user) return null;

  const rawToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await userRepository.savePasswordResetToken(user.id, sha256(rawToken), expiresAt);

  return { token: rawToken, expiresAt };
}

export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  const user = await userRepository.findUserByResetToken(sha256(input.token));

  if (!user) {
    throw new ValidationError(
      'This password reset link is invalid or has expired. Please request a new one.',
      [{ field: 'token', message: 'Reset link is invalid or expired.' }],
    );
  }

  const passwordHash = await hashPassword(input.newPassword);
  await userRepository.updatePasswordAndClearToken(user.id, passwordHash);
}
