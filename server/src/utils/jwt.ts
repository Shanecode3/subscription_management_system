import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import { UnauthorizedError } from './errors';

export type UserRole = 'ADMIN' | 'STAFF' | 'CUSTOMER';

export interface AuthTokenPayload extends JwtPayload {
  sub: string;
  role: UserRole;
  email: string;
}

export function signAuthToken(payload: { id: number; role: UserRole; email: string }): string {
  const options: SignOptions = {
    expiresIn: env.jwtExpiresIn as SignOptions['expiresIn'],
    issuer: 'brightloop',
  };

  return jwt.sign({ role: payload.role, email: payload.email }, env.jwtSecret, {
    ...options,
    subject: String(payload.id),
  });
}

export function verifyAuthToken(token: string): AuthTokenPayload {
  try {
    const decoded = jwt.verify(token, env.jwtSecret, { issuer: 'brightloop' });
    if (typeof decoded === 'string' || !decoded.sub) {
      throw new UnauthorizedError('Your session token is malformed. Please sign in again.');
    }
    return decoded as AuthTokenPayload;
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    if (error instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError('Your session has expired. Please sign in again.');
    }
    throw new UnauthorizedError('Your session token is invalid. Please sign in again.');
  }
}
