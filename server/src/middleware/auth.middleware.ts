import type { RequestHandler } from 'express';
import { ForbiddenError, UnauthorizedError } from '../utils/errors';
import { verifyAuthToken, type UserRole } from '../utils/jwt';
import { findPublicUserById } from '../repositories/user.repository';
import { asyncHandler } from './validate.middleware';

function extractBearerToken(header: string | undefined): string {
  if (!header) {
    throw new UnauthorizedError('Authentication is required. Please sign in.');
  }
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new UnauthorizedError('Send your access token as "Authorization: Bearer <token>".');
  }
  return token.trim();
}

/**
 * Verifies the JWT signature, then reloads the user so a deleted or
 * deactivated account cannot keep using an unexpired token.
 */
export const authenticate: RequestHandler = asyncHandler(async (req, _res, next) => {
  const token = extractBearerToken(req.headers.authorization);
  const payload = verifyAuthToken(token);

  const userId = Number(payload.sub);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new UnauthorizedError('Your session token is malformed. Please sign in again.');
  }

  const user = await findPublicUserById(userId);
  if (!user) {
    throw new UnauthorizedError('Your account no longer exists. Please sign in again.');
  }
  if (!user.is_active) {
    throw new ForbiddenError('This account has been deactivated. Please contact Brightloop support.');
  }

  req.user = { id: user.id, role: user.role, email: user.email };
  next();
});

/**
 * Route-level role gate. Always mounted after `authenticate`.
 * Example: router.post('/staff', requireRole('ADMIN'), handler)
 */
export function requireRole(...allowedRoles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication is required. Please sign in.'));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new ForbiddenError(
          `This action requires the ${allowedRoles.join(' or ')} role. Your account is ${req.user.role}.`,
        ),
      );
    }
    next();
  };
}
