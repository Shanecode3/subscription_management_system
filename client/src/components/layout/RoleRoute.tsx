import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth-context';
import type { Role } from '../../lib/types';

/**
 * Restricts a screen to specific roles. Mount it inside ProtectedRoute, which
 * has already resolved the session. A customer who guesses the URL lands back
 * on the dashboard instead of seeing an empty or leaked admin screen.
 */
export function RoleRoute({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();

  if (user && !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
