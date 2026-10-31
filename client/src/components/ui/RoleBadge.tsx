import type { Role } from '../../lib/types';
import { cx } from '../../lib/cx';

const ROLE_STYLES: Record<Role, { badge: string; label: string }> = {
  ADMIN: { badge: 'bg-plum-100 text-plum-800 ring-plum-200', label: 'Admin' },
  STAFF: { badge: 'bg-teal-100 text-teal-800 ring-teal-200', label: 'Internal Staff' },
  CUSTOMER: { badge: 'bg-slate-100 text-slate-700 ring-slate-200', label: 'Customer' },
};

export function RoleBadge({ role, compact = false }: { role: Role; compact?: boolean }) {
  const styles = ROLE_STYLES[role];

  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset',
        styles.badge,
      )}
      title={`Signed in with the ${styles.label} role`}
    >
      {compact ? role : styles.label}
    </span>
  );
}
