import { LogOut, Menu } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth-context';
import { titleForPath } from '../../lib/navigation';
import { BrandMark } from '../ui/BrandMark';
import { RoleBadge } from '../ui/RoleBadge';

export function Header({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onOpenMenu}
            aria-label="Open navigation"
            className="-ml-1 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-ink lg:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>

          <div className="lg:hidden">
            <BrandMark size="sm" />
          </div>

          <p className="hidden truncate text-sm font-semibold text-slate-600 lg:block">
            {titleForPath(location.pathname)}
          </p>
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
