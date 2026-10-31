import { withTransaction } from '../db/pool';
import { ConflictError, ForbiddenError } from '../utils/errors';
import { recordAuditEvent } from '../repositories/audit.repository';
import * as userRepository from '../repositories/user.repository';
import type { CreateStaffInput } from '../utils/validators';
import { hashPassword, toPublicUser, type PublicUser } from './auth.service';
import type { UserRole } from '../utils/jwt';

export interface Requester {
  id: number;
  role: UserRole;
}

export async function listAllUsers(): Promise<PublicUser[]> {
  const rows = await userRepository.listUsers();
  return rows.map(toPublicUser);
}

/**
 * Role is checked here as well as in the route middleware. If a future route
 * forgets `requireRole('ADMIN')`, this service still refuses the write.
 */
export async function createStaffMember(
  input: CreateStaffInput,
  requester: Requester,
): Promise<PublicUser> {
  if (requester.role !== 'ADMIN') {
    throw new ForbiddenError('Only an Admin can create internal staff accounts.');
  }

  const existing = await userRepository.findUserByEmail(input.email);
  if (existing) {
    throw new ConflictError('A user with this email address already exists.', [
      { field: 'email', message: 'This email address is already registered.' },
    ]);
  }

  const passwordHash = await hashPassword(input.password);

  return withTransaction(async (client) => {
    const created = await userRepository.insertUser(
      {
        name: input.name,
        email: input.email,
        passwordHash,
        role: 'STAFF',
        phone: input.phone ?? null,
      },
      client,
    );

    await recordAuditEvent(
      {
        entityType: 'USER',
        entityId: created.id,
        action: 'STAFF_CREATED',
        performedBy: requester.id,
        details: { email: created.email, role: 'STAFF' },
      },
      client,
    );

    return toPublicUser(created);
  });
}
