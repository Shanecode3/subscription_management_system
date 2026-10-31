import type { UserRole } from '../utils/jwt';

/** The authenticated actor behind a request, as reloaded from the database. */
export interface Requester {
  id: number;
  role: UserRole;
}
