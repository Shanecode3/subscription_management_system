import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  LayoutDashboard,
  LineChart,
  Package,
  CalendarClock,
  ScrollText,
  FileStack,
  PlayCircle,
  ReceiptText,
  BadgePercent,
  Scale,
  UserCheck,
  ArrowRight,
  X,
  CreditCard,
} from 'lucide-react';
import { useAuth } from '../../lib/auth-context';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../../lib/demo-accounts';
import type { Role } from '../../lib/types';

interface CommandItem {
  id: string;
  title: string;
  subtitle?: string;
  category: 'Navigation' | 'Demo Roles' | 'Quick Actions';
  icon: typeof Search;
  action: () => void;
  roles?: Role[];
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Define commands
  const allCommands: CommandItem[] = [
    // Navigation
    {
      id: 'nav-dashboard',
      title: 'Dashboard',
      subtitle: 'Overview & workspace status',
      category: 'Navigation',
      icon: LayoutDashboard,
      action: () => { navigate('/'); onClose(); },
    },
    {
      id: 'nav-finance',
      title: 'Finance Dashboard',
      subtitle: 'MRR, ARR, cash flow & overdue arrears',
      category: 'Navigation',
      icon: LineChart,
      roles: ['ADMIN', 'STAFF'],
      action: () => { navigate('/finance'); onClose(); },
    },
    {
      id: 'nav-billing',
      title: 'Billing Day Hub',
      subtitle: 'Execute recurring invoice batch run',
      category: 'Navigation',
      icon: PlayCircle,
      roles: ['ADMIN', 'STAFF'],
      action: () => { navigate('/billing'); onClose(); },
    },
    {
      id: 'nav-invoices',
      title: 'Invoices & Receipts',
      subtitle: 'View ledger, confirm or print invoices',
      category: 'Navigation',
      icon: ReceiptText,
      action: () => { navigate('/invoices'); onClose(); },
    },
    {
      id: 'nav-subscriptions',
      title: 'Subscriptions Board',
      subtitle: 'Lifecycle pipeline and contract stepper',
      category: 'Navigation',
      icon: FileStack,
      roles: ['ADMIN', 'STAFF'],
      action: () => { navigate('/subscriptions'); onClose(); },
    },
    {
      id: 'nav-portal',
      title: 'Customer Self-Service Portal',
      subtitle: 'Manage active subscriptions & add-ons',
      category: 'Navigation',
      icon: UserCheck,
      roles: ['CUSTOMER'],
      action: () => { navigate('/portal'); onClose(); },
    },
    {
      id: 'nav-products',
      title: 'Products & Variants',
      subtitle: 'Catalog & Odoo +560 edition prices',
      category: 'Navigation',
      icon: Package,
      action: () => { navigate('/products'); onClose(); },
    },
    {
      id: 'nav-plans',
      title: 'Subscription Plans',
      subtitle: 'Daily, weekly, monthly & yearly rules',
      category: 'Navigation',
      icon: CalendarClock,
      action: () => { navigate('/plans'); onClose(); },
    },
    {
      id: 'nav-templates',
      title: 'Quotation Templates',
      subtitle: 'Pre-configured sales packages',
      category: 'Navigation',
      icon: ScrollText,
      roles: ['ADMIN', 'STAFF'],
      action: () => { navigate('/templates'); onClose(); },
    },
    {
      id: 'nav-discounts',
      title: 'Discount Rules',
      subtitle: 'Admin-governed promotions & usage caps',
      category: 'Navigation',
      icon: BadgePercent,
      roles: ['ADMIN', 'STAFF'],
      action: () => { navigate('/discounts'); onClose(); },
    },
    {
      id: 'nav-taxes',
      title: 'Tax Rules',
      subtitle: 'GST, VAT & exempt rate settings',
      category: 'Navigation',
      icon: Scale,
      roles: ['ADMIN', 'STAFF'],
      action: () => { navigate('/tax-rules'); onClose(); },
    },

    // Quick Roles Switching
    ...DEMO_ACCOUNTS.map((account) => ({
      id: `role-${account.role.toLowerCase()}`,
      title: `Switch to ${account.label}`,
      subtitle: account.email,
      category: 'Demo Roles' as const,
      icon: UserCheck,
      action: async () => {
        try {
          await login(account.email, DEMO_PASSWORD);
        } catch {
          // ignore error if role switch fails
        }
        onClose();
      },
    })),

    // Quick Actions
    {
      id: 'act-run-billing',
      title: 'Quick Action: Go to Billing Run',
      subtitle: 'Open 1-click batch invoicing',
      category: 'Quick Actions',
      icon: PlayCircle,
      roles: ['ADMIN', 'STAFF'],
      action: () => { navigate('/billing'); onClose(); },
    },
    {
      id: 'act-view-overdue',
      title: 'Quick Action: View Overdue Invoices',
      subtitle: 'Jump to collections chase list',
      category: 'Quick Actions',
      icon: CreditCard,
      roles: ['ADMIN', 'STAFF'],
      action: () => { navigate('/finance#overdue-chase'); onClose(); },
    },
  ];

  // Filter commands by user role and search query
  const availableCommands = allCommands.filter((cmd) => {
    if (cmd.roles && user && !cmd.roles.includes(user.role)) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      cmd.title.toLowerCase().includes(q) ||
      (cmd.subtitle && cmd.subtitle.toLowerCase().includes(q)) ||
      cmd.category.toLowerCase().includes(q)
    );
  });

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(availableCommands.length, 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + availableCommands.length) % Math.max(availableCommands.length, 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (availableCommands[selectedIndex]) {
          availableCommands[selectedIndex].action();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, availableCommands, selectedIndex, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 px-4 bg-slate-900/40 backdrop-blur-sm transition-opacity">
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="relative flex items-center border-b border-slate-100 px-4 py-3">
          <Search className="h-4 w-4 text-slate-400 shrink-0 mr-3" />
          <input
            ref={inputRef}
            type="text"
            className="w-full bg-transparent text-sm text-ink placeholder:text-slate-400 focus:outline-none"
            placeholder="Type a screen, quick action, or switch demo role..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
          />
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Command List */}
        <div className="max-h-80 overflow-y-auto p-2 space-y-1">
          {availableCommands.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              No matching commands or screens found.
            </div>
          ) : (
            availableCommands.map((item, idx) => {
              const Icon = item.icon;
              const isSelected = idx === selectedIndex;

              return (
                <div
                  key={item.id}
                  onClick={item.action}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-xs transition-colors ${
                    isSelected ? 'bg-plum-50 text-plum-950 font-medium' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                        isSelected ? 'bg-plum-700 text-white' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="truncate">
                      <p className="truncate font-semibold">{item.title}</p>
                      {item.subtitle ? (
                        <p className="truncate text-[11px] text-slate-400">{item.subtitle}</p>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500">
                      {item.category}
                    </span>
                    <ArrowRight className={`h-3 w-3 ${isSelected ? 'text-plum-700' : 'text-slate-300'}`} />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/70 px-4 py-2 text-[10px] text-slate-400">
          <div className="flex items-center gap-3">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>Esc Close</span>
          </div>
          <span className="font-medium text-plum-700">Brightloop Fast Command</span>
        </div>
      </div>
    </div>
  );
}
