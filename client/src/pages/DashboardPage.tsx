import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Layers,
  LineChart,
  Package,
  Percent,
  PlayCircle,
  ReceiptText,
  RefreshCw,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { useAuth } from '../lib/auth-context';
import { cx } from '../lib/cx';
import { billingSuffix, formatDate, formatMoney, intervalLabel } from '../lib/format';
import type { DashboardSummary, FinanceDashboard, Role, Subscription } from '../lib/types';
import { useApiResource } from '../lib/use-api-resource';

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

/**
 * Status colours are the vocabulary the rest of the app already uses on its
 * badges, repeated here so a slice on a bar and a badge on a table are the same
 * state at a glance. Every slice is labelled in the legend, so colour is never
 * the only thing carrying the meaning.
 */
const INVOICE_STATUS_COLOR: Record<string, string> = {
  Draft: 'bg-slate-400',
  Confirmed: 'bg-amber-500',
  Paid: 'bg-emerald-500',
  Cancelled: 'bg-rose-400',
};

const SUBSCRIPTION_STATUS_COLOR: Record<string, string> = {
  Draft: 'bg-slate-400',
  Quotation: 'bg-plum-400',
  Confirmed: 'bg-teal-500',
  Active: 'bg-emerald-500',
  Paused: 'bg-amber-500',
  Closed: 'bg-slate-300',
};

const PRODUCT_TYPE_COLOR: Record<string, string> = {
  Software: 'bg-plum-600',
  Service: 'bg-teal-600',
  'Add-on': 'bg-amber-400',
};

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

/**
 * Every card is one link: the whole surface is the hit target, the arrow is the
 * affordance, and the hover/focus ring says so before the click.
 */
function SectionCard({
  to,
  icon: Icon,
  title,
  hint,
  footer,
  className,
  children,
}: {
  to: string;
  icon: LucideIcon;
  title: string;
  hint: string;
  footer?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      aria-label={`Open ${title}`}
      className={cx(
        'card group flex flex-col p-5 transition duration-150',
        'hover:-translate-y-0.5 hover:border-plum-300 hover:shadow-lg',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-plum-50 ring-1 ring-inset ring-plum-100">
            <Icon className="h-4 w-4 text-plum-700" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-ink">{title}</h2>
            <p className="truncate text-xs text-slate-500">{hint}</p>
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-slate-400 transition-colors group-hover:text-plum-700">
          Open
          <ArrowRight
            className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </span>
      </div>

      <div className="mt-4 flex-1">{children}</div>

      {footer ? (
        <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">{footer}</p>
      ) : null}
    </Link>
  );
}

function CardSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <div className="h-8 w-28 animate-pulse rounded-lg bg-slate-100" />
      <div className="h-2 w-full animate-pulse rounded-full bg-slate-100" />
      <div className="h-2 w-4/5 animate-pulse rounded-full bg-slate-100" />
    </div>
  );
}

/** One labelled magnitude bar: the label names the row, the bar ranks it. */
function BarRow({
  label,
  value,
  max,
  display,
  color,
}: {
  label: string;
  value: number;
  max: number;
  display: string;
  color: string;
}) {
  const width = max > 0 ? Math.max(value > 0 ? 4 : 0, Math.round((value / max) * 100)) : 0;

  return (
    <li className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3">
      <span className="truncate text-xs text-slate-600">{label}</span>
      <span className="h-1.5 rounded-full bg-slate-100">
        <span
          className={cx('block h-1.5 rounded-full transition-[width] duration-300', color)}
          style={{ width: `${width}%` }}
        />
      </span>
      <span className="text-right text-xs font-semibold tabular-nums text-ink">{display}</span>
    </li>
  );
}

interface StatusSlice {
  label: string;
  count: number;
  color: string;
}

/** A single stacked bar plus its legend — identity is always written out. */
function StatusBar({ slices, empty }: { slices: StatusSlice[]; empty: string }) {
  const visible = slices.filter((slice) => slice.count > 0);
  const total = visible.reduce((sum, slice) => sum + slice.count, 0);

  if (total === 0) {
    return <p className="text-xs text-slate-500">{empty}</p>;
  }

  return (
    <>
      <div
        className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-slate-100"
        role="img"
        aria-label={visible.map((slice) => `${slice.label}: ${slice.count}`).join(', ')}
      >
        {visible.map((slice) => (
          <span
            key={slice.label}
            className={cx('h-full first:rounded-l-full last:rounded-r-full', slice.color)}
            style={{ flexGrow: slice.count, flexBasis: 0 }}
          />
        ))}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {visible.map((slice) => (
          <li key={slice.label} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className={cx('h-2 w-2 rounded-full', slice.color)} aria-hidden="true" />
            {slice.label}
            <span className="font-semibold tabular-nums text-ink">
              {slice.count.toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function StatCell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={cx('mt-0.5 text-sm font-semibold tabular-nums', tone ?? 'text-ink')}>{value}</p>
    </div>
  );
}

/** "How many of these rules are live?" — the bar is the answer, the note is why it matters. */
function RuleCoverage({
  icon: Icon,
  iconClass,
  label,
  active,
  total,
  color,
  note,
}: {
  icon: LucideIcon;
  iconClass: string;
  label: string;
  active: number;
  total: number;
  color: string;
  note: string;
}) {
  const percent = total > 0 ? Math.round((active / total) * 100) : 0;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 text-slate-600">
          <Icon className={cx('h-3.5 w-3.5', iconClass)} aria-hidden="true" />
          {label}
        </span>
        <span className="font-semibold tabular-nums text-ink">
          {active.toLocaleString()} of {total.toLocaleString()}
        </span>
      </div>
      <span className="mt-1.5 block h-1.5 rounded-full bg-slate-100">
        <span
          className={cx('block h-1.5 rounded-full transition-[width] duration-300', color)}
          style={{ width: `${percent}%` }}
        />
      </span>
      <p className="mt-1 text-xs text-slate-500">{note}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function DashboardPage() {
  const { user } = useAuth();

  const isInternal = user?.role === 'ADMIN' || user?.role === 'STAFF';

  // A customer has no business reading company-wide aggregates, so the paths go
  // null and the hook skips the call instead of letting it come back forbidden.
  const finance = useApiResource<FinanceDashboard>(isInternal ? '/finance/dashboard' : null);
  const summary = useApiResource<DashboardSummary>(isInternal ? '/dashboard/summary' : null);
  // A customer's own contracts come from the portal endpoint, which applies the
  // tenant filter server-side, so this call can only ever return their rows.
  const portal = useApiResource<Subscription[]>(isInternal ? null : '/portal/subscriptions');

  if (!user) return null;

  const capabilities = ROLE_CAPABILITIES[user.role];
  const firstName = user.name.split(' ')[0] ?? user.name;
  const memberSince = new Date(user.createdAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const loading = finance.isLoading || summary.isLoading || portal.isLoading;
  const loadError = finance.error ?? summary.error ?? portal.error;

  const refreshAll = () => {
    finance.reload();
    summary.reload();
    portal.reload();
  };

  const money = finance.data;
  const stats = summary.data;

  const mySubscriptions = portal.data ?? [];
  const myActive = mySubscriptions.filter((item) => item.status === 'Active');
  const nextBillDate =
    myActive
      .map((item) => item.nextBillingDate)
      .filter((value): value is string => Boolean(value))
      .sort()[0] ?? null;

  const intervalMax = Math.max(0, ...(money?.mrrByInterval.map((slice) => slice.mrr) ?? [0]));
  const productMax = Math.max(0, ...(stats?.catalogue.products.byType.map((row) => row.count) ?? [0]));

  const subscriptionSlices: StatusSlice[] =
    stats?.subscriptions.byStatus.map((row) => ({
      label: row.status,
      count: row.count,
      color: SUBSCRIPTION_STATUS_COLOR[row.status] ?? 'bg-slate-400',
    })) ?? [];

  const invoiceSlices: StatusSlice[] =
    stats?.invoices.byStatus.map((row) => ({
      label: row.status,
      count: row.count,
      color: INVOICE_STATUS_COLOR[row.status] ?? 'bg-slate-400',
    })) ?? [];

  const activeSubscriptions =
    subscriptionSlices.find((slice) => slice.label === 'Active')?.count ?? 0;

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
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              className="w-auto"
              onClick={refreshAll}
              isLoading={loading && (money !== null || stats !== null || portal.data !== null)}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Refresh
            </Button>
          </div>
        </header>

        {loadError && (money !== null || stats !== null || portal.data !== null) ? (
          <Alert tone="error" title="Some figures could not be refreshed">
            {loadError}
          </Alert>
        ) : null}

        {isInternal ? (
          <>
            <section className="grid gap-5 lg:grid-cols-3" aria-label="Workspace summary">
              {/* Finance ------------------------------------------------------ */}
              <SectionCard
                to="/finance"
                icon={TrendingUp}
                title="Finance"
                hint="Recurring revenue, cash and what is owed"
                className="lg:col-span-2"
                footer={
                  money
                    ? `Aggregated by PostgreSQL in ${money.queryTimeMs} ms · ${money.totalPayments.toLocaleString()} receipt${money.totalPayments === 1 ? '' : 's'} on file`
                    : undefined
                }
              >
                {money ? (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="flex items-center gap-1.5 text-xs text-slate-500">
                          <LineChart className="h-3.5 w-3.5 text-plum-600" aria-hidden="true" />
                          MRR
                        </p>
                        <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-ink">
                          {formatMoney(money.mrr)}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {formatMoney(money.arr)} annualised
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-semibold tabular-nums tracking-tight text-plum-700">
                          {money.activeSubscriptions.toLocaleString()}
                        </p>
                        <p className="text-xs text-slate-500">
                          active contract{money.activeSubscriptions === 1 ? '' : 's'}
                        </p>
                      </div>
                    </div>

                    {money.mrrByInterval.length > 0 ? (
                      <ul
                        className="mt-4 space-y-2"
                        aria-label="Recurring revenue by billing interval"
                      >
                        {money.mrrByInterval.map((slice) => (
                          <BarRow
                            key={slice.billingInterval}
                            label={intervalLabel(slice.billingInterval)}
                            value={slice.mrr}
                            max={intervalMax}
                            display={formatMoney(slice.mrr)}
                            color="bg-plum-500"
                          />
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-4 text-xs text-slate-500">
                        No active contract is billing yet — recurring revenue starts at the first
                        activation.
                      </p>
                    )}

                    <div className="mt-4 grid grid-cols-3 gap-3 border-t border-slate-100 pt-3">
                      <StatCell
                        label="Collected"
                        value={formatMoney(money.totalRevenueCollected)}
                        tone="text-emerald-700"
                      />
                      <StatCell
                        label="Owed"
                        value={formatMoney(money.totalOutstandingOwed)}
                        tone="text-amber-700"
                      />
                      <StatCell
                        label="Overdue"
                        value={`${money.overdueInvoiceCount.toLocaleString()} invoice${money.overdueInvoiceCount === 1 ? '' : 's'}`}
                        tone={money.overdueInvoiceCount > 0 ? 'text-rose-700' : undefined}
                      />
                    </div>
                  </>
                ) : (
                  <CardSkeleton />
                )}
              </SectionCard>

              {/* Billing day -------------------------------------------------- */}
              <SectionCard
                to="/billing"
                icon={PlayCircle}
                title="Billing day"
                hint="What the next run will invoice"
                footer="Every run is idempotent — no cycle is ever billed twice."
              >
                {stats ? (
                  <>
                    <p className="text-xs text-slate-500">Contracts due</p>
                    <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-ink">
                      {stats.billing.dueCount.toLocaleString()}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatMoney(stats.billing.dueTotal)} to invoice
                    </p>

                    {stats.billing.due.length > 0 ? (
                      <ul className="mt-3 space-y-1.5">
                        {stats.billing.due.map((item) => (
                          <li
                            key={item.subscriptionNumber}
                            title={`Bills on ${formatDate(item.nextBillingDate)}`}
                            className="flex items-baseline justify-between gap-2 text-xs"
                          >
                            <span className="min-w-0 truncate">
                              <span className="font-medium text-ink">
                                {item.subscriptionNumber}
                              </span>
                              <span className="ml-1.5 text-slate-500">{item.customerName}</span>
                            </span>
                            <span className="shrink-0 font-semibold tabular-nums text-ink">
                              {formatMoney(item.totalAmount)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-3 text-xs text-slate-500">
                        Nothing is due — the queue is clear until the next billing date.
                      </p>
                    )}

                    {stats.billing.closingCount > 0 ? (
                      <p className="mt-3 text-xs font-medium text-amber-700">
                        {stats.billing.closingCount} contract
                        {stats.billing.closingCount === 1 ? '' : 's'} reach expiry and will close
                        automatically.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <CardSkeleton />
                )}
              </SectionCard>

              {/* Invoices ----------------------------------------------------- */}
              <SectionCard
                to="/invoices"
                icon={ReceiptText}
                title="Invoices"
                hint="Status mix and what is still unpaid"
                className="lg:col-span-2"
                footer="Drafts are not owed yet; confirming an invoice is what puts it in the ledger."
              >
                {stats && money ? (
                  <>
                    <StatusBar
                      slices={invoiceSlices}
                      empty="No invoice has been generated yet."
                    />
                    <div className="mt-4 grid grid-cols-3 gap-3 border-t border-slate-100 pt-3">
                      <StatCell
                        label="Outstanding"
                        value={formatMoney(money.totalOutstandingOwed)}
                        tone="text-amber-700"
                      />
                      <StatCell
                        label="Open invoices"
                        value={money.openInvoiceCount.toLocaleString()}
                      />
                      <StatCell
                        label="Billed to date"
                        value={formatMoney(
                          stats.invoices.byStatus
                            .filter((row) => row.status !== 'Cancelled')
                            .reduce((sum, row) => sum + row.amount, 0),
                        )}
                      />
                    </div>
                  </>
                ) : (
                  <CardSkeleton />
                )}
              </SectionCard>

              {/* Subscriptions ------------------------------------------------ */}
              <SectionCard
                to="/subscriptions"
                icon={Layers}
                title="Subscriptions"
                hint="Contract mix across the lifecycle"
                footer="Draft → Quotation → Confirmed → Active, with Paused and Closed as exits."
              >
                {stats ? (
                  <>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-3xl font-semibold tabular-nums tracking-tight text-ink">
                        {activeSubscriptions.toLocaleString()}
                      </p>
                      <p className="text-xs text-slate-500">
                        active of {stats.subscriptions.total.toLocaleString()} contract
                        {stats.subscriptions.total === 1 ? '' : 's'}
                      </p>
                    </div>
                    <div className="mt-3">
                      <StatusBar
                        slices={subscriptionSlices}
                        empty="No contract has been created yet."
                      />
                    </div>
                  </>
                ) : (
                  <CardSkeleton />
                )}
              </SectionCard>

              {/* Catalogue ---------------------------------------------------- */}
              <SectionCard
                to="/products"
                icon={Package}
                title="Catalogue"
                hint="Products, plans and templates"
                footer={`${stats?.catalogue.plans.total ?? 0} plan${stats?.catalogue.plans.total === 1 ? '' : 's'} · ${stats?.catalogue.templates.total ?? 0} quotation template${stats?.catalogue.templates.total === 1 ? '' : 's'}`}
              >
                {stats ? (
                  <>
                    <p className="text-xs text-slate-500">Products by type</p>
                    <ul className="mt-2 space-y-2" aria-label="Products by type">
                      {stats.catalogue.products.byType.map((row) => (
                        <BarRow
                          key={row.type}
                          label={row.type}
                          value={row.count}
                          max={productMax}
                          display={row.count.toLocaleString()}
                          color={PRODUCT_TYPE_COLOR[row.type] ?? 'bg-slate-400'}
                        />
                      ))}
                    </ul>
                    <p className="mt-3 text-xs text-slate-500">
                      {stats.catalogue.products.active === stats.catalogue.products.total
                        ? `All ${stats.catalogue.products.total.toLocaleString()} products are active`
                        : `${stats.catalogue.products.active.toLocaleString()} of ${stats.catalogue.products.total.toLocaleString()} products active`}
                    </p>
                  </>
                ) : (
                  <CardSkeleton />
                )}
              </SectionCard>

              {/* Discounts and taxes ------------------------------------------- */}
              <SectionCard
                to="/discounts"
                icon={Percent}
                title="Discounts & tax"
                hint="Rules attached to the next invoice"
                footer="Expired or exhausted rules stop applying without anyone removing them."
              >
                {stats ? (
                  <div className="space-y-3.5">
                    <RuleCoverage
                      icon={CircleDollarSign}
                      iconClass="text-amber-600"
                      label="Discounts live"
                      active={stats.discounts.active}
                      total={stats.discounts.total}
                      color="bg-amber-400"
                      note={`${stats.discounts.usesRemaining.toLocaleString()} uses left before they stop applying`}
                    />
                    <RuleCoverage
                      icon={Percent}
                      iconClass="text-teal-600"
                      label="Tax rules live"
                      active={stats.taxRules.active}
                      total={stats.taxRules.total}
                      color="bg-teal-500"
                      note={`Default rate ${stats.taxRules.defaultRate.toLocaleString(undefined, {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 2,
                      })}% where a line has no override`}
                    />
                  </div>
                ) : (
                  <CardSkeleton />
                )}
              </SectionCard>

              {/* Account ------------------------------------------------------ */}
              <section className="card flex flex-col p-5" aria-label="Account">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 ring-1 ring-inset ring-slate-200">
                    <CalendarDays className="h-4 w-4 text-slate-600" aria-hidden="true" />
                  </span>
                  <h2 className="text-sm font-semibold text-ink">Your account</h2>
                </div>
                <dl className="mt-4 space-y-2.5 text-sm">
                  <div>
                    <dt className="text-xs text-slate-500">Name</dt>
                    <dd className="font-medium text-ink">{user.name}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Email</dt>
                    <dd className="break-all font-medium text-ink">{user.email}</dd>
                  </div>
                  {user.companyName ? (
                    <div>
                      <dt className="text-xs text-slate-500">Company</dt>
                      <dd className="font-medium text-ink">{user.companyName}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="text-xs text-slate-500">Member since</dt>
                    <dd className="font-medium text-ink">{memberSince}</dd>
                  </div>
                </dl>
              </section>
            </section>

            <section className="card p-5" aria-label="Your access">
              <h2 className="text-sm font-semibold text-ink">Your access</h2>
              <p className="mt-1 text-sm text-slate-600">{capabilities.summary}</p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-3">
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
          </>
        ) : (
          <section className="grid gap-5 lg:grid-cols-3" aria-label="Your workspace">
            <SectionCard
              to="/portal"
              icon={Layers}
              title="Customer portal"
              hint="Your subscriptions and invoices"
              className="lg:col-span-2"
              footer="Add-ons, pauses and renewals are yours to manage wherever the plan allows."
            >
              {portal.data ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs text-slate-500">Active subscriptions</p>
                      <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-ink">
                        {myActive.length.toLocaleString()}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        of {mySubscriptions.length.toLocaleString()} contract
                        {mySubscriptions.length === 1 ? '' : 's'} held
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-500">Next bill</p>
                      <p className="mt-1 text-sm font-semibold text-ink">
                        {nextBillDate ? formatDate(nextBillDate) : 'Nothing scheduled'}
                      </p>
                    </div>
                  </div>

                  {mySubscriptions.length > 0 ? (
                    <ul className="mt-4 space-y-1.5 border-t border-slate-100 pt-3">
                      {mySubscriptions.map((item) => (
                        <li
                          key={item.id}
                          className="flex items-baseline justify-between gap-3 text-xs"
                        >
                          <span className="min-w-0 truncate text-slate-600">
                            <span className="font-medium text-ink">{item.planName}</span>
                            <span className="ml-1.5">
                              {formatMoney(item.total)} / {billingSuffix(item.billingInterval)}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5 text-slate-600">
                            <span
                              className={cx(
                                'h-2 w-2 rounded-full',
                                SUBSCRIPTION_STATUS_COLOR[item.status] ?? 'bg-slate-400',
                              )}
                              aria-hidden="true"
                            />
                            {item.status}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-4 text-sm text-slate-600">
                      You have no subscriptions yet. Your account manager can set one up from a
                      quotation, and it will appear here the moment it is confirmed.
                    </p>
                  )}
                </>
              ) : (
                <CardSkeleton />
              )}
            </SectionCard>

            <section className="card flex flex-col p-5" aria-label="Account">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 ring-1 ring-inset ring-slate-200">
                  <CalendarDays className="h-4 w-4 text-slate-600" aria-hidden="true" />
                </span>
                <h2 className="text-sm font-semibold text-ink">Your account</h2>
              </div>
              <dl className="mt-4 space-y-2.5 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Name</dt>
                  <dd className="font-medium text-ink">{user.name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Email</dt>
                  <dd className="break-all font-medium text-ink">{user.email}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Member since</dt>
                  <dd className="font-medium text-ink">{memberSince}</dd>
                </div>
              </dl>
            </section>
          </section>
        )}
      </div>
    </AppShell>
  );
}
