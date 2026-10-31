import { LogOut, Menu, Search } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth-context';
import { titleForPath } from '../../lib/navigation';
import { BrandMark } from '../ui/BrandMark';
import { RoleBadge } from '../ui/RoleBadge';

export function Header({
  onOpenMenu,
  onOpenCommand,
}: {
  onOpenMenu: () => void;
  onOpenCommand?: () => void;
}) {
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
            <BrandMark size="sm" compact />
          </div>

          <p className="hidden truncate text-sm font-semibold text-slate-600 lg:block">
            {titleForPath(location.pathname)}
          </p>
        </div>

        {/* Global Command Palette search trigger pill */}
        {onOpenCommand && user ? (
          <button
            type="button"
            onClick={onOpenCommand}
            aria-label="Search, navigate, or run an action"
            className="flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-1.5 text-xs text-slate-500 transition-all hover:border-slate-300 hover:bg-slate-100 hover:text-ink"
            title="Press Ctrl+K or Cmd+K to search"
          >
            <Search className="h-3.5 w-3.5 text-slate-400" />
            <span className="hidden sm:inline">Search, navigate, or action...</span>
            <kbd className="hidden sm:inline-flex items-center rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 shadow-sm">
              ⌘K
            </kbd>
          </button>
        ) : null}

        {user ? (
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold leading-tight text-ink">{user.name}</p>
              <p className="text-xs leading-tight text-slate-500">{user.email}</p>
            </div>

            {/* Persistent role badge */}
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
