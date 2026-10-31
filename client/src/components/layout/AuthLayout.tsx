import { BarChart3, FileCheck2, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { BrandMark } from '../ui/BrandMark';

const HIGHLIGHTS = [
  {
    icon: ShieldCheck,
    title: 'Role-scoped access',
    body: 'Admin, staff and customer views are separated by signed sessions and server-side role checks.',
  },
  {
    icon: FileCheck2,
    title: 'Billing that cannot double-charge',
    body: 'Every invoice carries a unique billing-cycle key, so a repeated billing run is a no-op.',
  },
  {
    icon: BarChart3,
    title: 'Finance answers in one screen',
    body: 'Recurring revenue, collections and overdue balances aggregate inside PostgreSQL.',
  },
];

/**
 * Two-column auth shell: brand story on the left (desktop only), form on the right.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-surface lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <aside className="relative hidden overflow-hidden bg-plum-700 px-12 py-14 lg:flex lg:flex-col lg:justify-between">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-plum-500/40 blur-3xl"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-teal-500/20 blur-3xl"
          aria-hidden="true"
        />

        <div className="relative">
          <BrandMark tone="light" />
        </div>

        <div className="relative max-w-md space-y-8">
          <div className="space-y-3">
            <h2 className="text-3xl font-semibold leading-tight text-white">
              One platform for every recurring contract.
            </h2>
            <p className="text-sm leading-relaxed text-white/70">
              Brightloop Software runs signup, quotations, billing runs, payments and revenue
              reporting on a single PostgreSQL ledger.
            </p>
          </div>

          <ul className="space-y-5">
            {HIGHLIGHTS.map(({ icon: Icon, title: highlightTitle, body }) => (
              <li key={highlightTitle} className="flex gap-3.5">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-inset ring-white/15">
                  <Icon className="h-4 w-4 text-white" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">{highlightTitle}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-white/65">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/45">
          Odoo × Make-A-Ton 9.0 · Brightloop Software
        </p>
      </aside>

      <main className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <BrandMark />
          </div>

          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
            <p className="mt-1.5 text-sm text-slate-600">{subtitle}</p>
          </div>

          <div className="card p-6 sm:p-7">{children}</div>

          {footer ? <div className="mt-6 text-center text-sm text-slate-600">{footer}</div> : null}
        </div>
      </main>
    </div>
  );
}
