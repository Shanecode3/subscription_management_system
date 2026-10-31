import { X } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { cx } from '../../lib/cx';
import { useAuth } from '../../lib/auth-context';
import { navItemsForRole } from '../../lib/navigation';
import { BrandMark } from '../ui/BrandMark';

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  if (!user) return null;

  const items = navItemsForRole(user.role);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pb-5 pt-5">
        <BrandMark size="sm" tone="light" />
        {onNavigate ? (
          <button
            type="button"
            onClick={onNavigate}
            aria-label="Close navigation"
            className="rounded-lg p-1.5 text-plum-200 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <nav className="flex-1 space-y-0.5">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              cx(
                'flex items-center gap-2.5 border-l-2 px-4 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'border-teal-300 bg-white/10 text-white'
                  : 'border-transparent text-plum-100 hover:bg-white/5 hover:text-white',
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-white/10 px-4 py-4">
        <p className="text-[11px] font-medium text-plum-200">Brightloop Software</p>
        <p className="text-[11px] text-plum-300/80">Subscription Suite · local PostgreSQL</p>
      </div>
    </div>
  );
}

/**
 * Desktop: a fixed plum rail. Mobile: the same content in a drawer rendered
 * only while open, so its links never become invisible tab stops.
 */
export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <>
      <aside className="hidden w-60 shrink-0 lg:block">
        <div className="sticky top-0 h-screen bg-plum-800">
          <SidebarContent />
        </div>
      </aside>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-plum-900/50"
            onClick={onClose}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 w-64 bg-plum-800 shadow-xl">
            <SidebarContent onNavigate={onClose} />
          </div>
        </div>
      ) : null}
    </>
  );
}
