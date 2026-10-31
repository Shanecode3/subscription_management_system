import {
  CalendarClock,
  LayoutDashboard,
  Package,
  ScrollText,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from './types';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
}

/**
 * One list drives both the sidebar and the route guards, so a screen can never
 * appear in the navigation without also being protected.
 */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ['ADMIN', 'STAFF', 'CUSTOMER'] },
  { to: '/products', label: 'Products', icon: Package, roles: ['ADMIN', 'STAFF', 'CUSTOMER'] },
  { to: '/plans', label: 'Plans', icon: CalendarClock, roles: ['ADMIN', 'STAFF', 'CUSTOMER'] },
  {
    to: '/templates',
    label: 'Quotation templates',
    icon: ScrollText,
    roles: ['ADMIN', 'STAFF'],
  },
];

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/products': 'Products',
  '/plans': 'Plans',
  '/templates': 'Quotation templates',
};

export function navItemsForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

export function titleForPath(pathname: string): string {
  return PAGE_TITLES[pathname] ?? 'Brightloop';
}
