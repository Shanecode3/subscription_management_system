import { LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth-context';
import { BrandMark } from '../ui/BrandMark';
import { RoleBadge } from '../ui/RoleBadge';

export function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <div className="flex items-center gap-3">
          <BrandMark size="sm" />
        </div>

        {user ? (
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold leading-tight text-ink">{user.name}</p>
              <p className="text-xs leading-tight text-slate-500">{user.email}</p>
            </div>

            {/* Persistent role badge: the current RBAC identity is always visible. */}
            <RoleBadge role={user.role} />

            <button
              type="button"
              onClick={handleLogout}
              className="btn-secondary w-auto px-3 py-2 text-xs"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Sign out</span>
              <span className="sr-only sm:hidden">Sign out</span>
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
