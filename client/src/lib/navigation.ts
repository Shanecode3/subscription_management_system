import {
  CalendarClock,
  FileStack,
  LayoutDashboard,
  Package,
  ReceiptText,
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
  { to: '/subscriptions', label: 'Subscriptions', icon: FileStack, roles: ['ADMIN', 'STAFF'] },
  { to: '/portal', label: 'My subscriptions', icon: ReceiptText, roles: ['CUSTOMER'] },
];

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/products': 'Products',
  '/plans': 'Plans',
  '/templates': 'Quotation templates',
  '/subscriptions': 'Subscriptions',
  '/portal': 'My subscriptions',
};

export function navItemsForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

export function titleForPath(pathname: string): string {
  if (pathname.startsWith('/subscriptions/')) return 'Subscription';
  return PAGE_TITLES[pathname] ?? 'Brightloop';
}
