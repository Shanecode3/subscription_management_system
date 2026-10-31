import {
  CalendarDays,
  CheckCircle2,
  Database,
  KeyRound,
  LineChart,
  Mail,
  PlayCircle,
  ReceiptText,
  ShieldCheck,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { RoleBadge } from '../components/ui/RoleBadge';
import { useAuth } from '../lib/auth-context';
import type { Role } from '../lib/types';

const ROLE_CAPABILITIES: Record<Role, { summary: string; items: string[] }> = {
  ADMIN: {
    summary: 'Full access to the platform, including the actions only an Admin may perform.',
    items: [
      'Create internal staff accounts',
      'Author discount rules',
      'Manage products, plans and tax rules',
    ],
  },
  STAFF: {
    summary: 'Runs day-to-day sales and billing. Cannot create staff or discount rules.',
    items: [
      'Build quotations and subscriptions',
      'Execute billing day runs',
      'Record payments against invoices',
    ],
  },
  CUSTOMER: {
    summary: 'Sees only their own subscriptions and invoices in the customer portal.',
    items: [
      'View personal subscriptions and invoices',
      'Toggle add-ons on and off',
      'Pause, renew or close a subscription where the plan allows',
    ],
  },
};

const FOUNDATION_ITEMS = [
  { icon: Database, label: 'Normalized PostgreSQL schema', detail: '14 tables with foreign keys, checks and composite indexes' },
  { icon: KeyRound, label: 'Password authentication', detail: 'bcrypt hashing with signed JWT sessions' },
  { icon: ShieldCheck, label: 'Role-based access control', detail: 'Server-side role guards on every protected route' },
  { icon: Mail, label: 'Forgot password flow', detail: 'Hashed, one-hour reset tokens' },
];

export function DashboardPage() {
  const { user } = useAuth();

  if (!user) return null;

  const capabilities = ROLE_CAPABILITIES[user.role];
  const firstName = user.name.split(' ')[0] ?? user.name;
  const memberSince = new Date(user.createdAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-slate-500">Signed in as</p>
            <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-ink">
              Welcome back, {firstName}
            </h1>
          </div>
          <RoleBadge role={user.role} />
        </header>

        {user.role !== 'CUSTOMER' ? (
          <nav className="flex flex-wrap gap-2" aria-label="Finance shortcuts">
            <Link to="/finance" className="btn-secondary w-auto">
              <LineChart className="h-4 w-4" aria-hidden="true" />
              Finance dashboard
            </Link>
            <Link to="/billing" className="btn-secondary w-auto">
              <PlayCircle className="h-4 w-4" aria-hidden="true" />
              Billing day
            </Link>
            <Link to="/invoices" className="btn-secondary w-auto">
              <ReceiptText className="h-4 w-4" aria-hidden="true" />
              Invoice ledger
            </Link>
          </nav>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-3">
          <section className="card p-6 lg:col-span-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Your access
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">{capabilities.summary}</p>

            <ul className="mt-4 grid gap-2 sm:grid-cols-1">
              {capabilities.items.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-ink">
                  <CheckCircle2
                    className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
                    aria-hidden="true"
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Account
            </h2>
            <dl className="mt-3 space-y-3 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">Name</dt>
                <dd className="font-medium text-ink">{user.name}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">Email</dt>
                <dd className="break-all font-medium text-ink">{user.email}</dd>
              </div>
              {user.companyName ? (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-400">Company</dt>
                  <dd className="font-medium text-ink">{user.companyName}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">Member since</dt>
                <dd className="flex items-center gap-1.5 font-medium text-ink">
                  <CalendarDays className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  {memberSince}
                </dd>
              </div>
            </dl>
          </section>
        </div>

        <section className="card p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Platform foundation
            </h2>
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
              Milestone 1 complete
            </span>
          </div>

          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {FOUNDATION_ITEMS.map(({ icon: Icon, label, detail }) => (
              <li
                key={label}
                className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3.5"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-inset ring-slate-200">
                  <Icon className="h-4 w-4 text-plum-700" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink">{label}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
