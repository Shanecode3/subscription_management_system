import type { UserRole } from '../utils/jwt';

declare global {
  namespace Express {
    interface Request {
      /**
       * Populated by the `authenticate` middleware from a verified JWT and a
       * fresh database lookup. Never trust a role claim straight from the token
       * body — the database is the source of truth.
       */
      user?: {
        id: number;
        role: UserRole;
        email: string;
      };
    }
  }
}

export {};
