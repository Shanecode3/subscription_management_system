import { performance } from 'node:perf_hooks';
import * as financeRepository from '../repositories/finance.repository';
import type { FinanceFilter } from '../repositories/finance.repository';
import type { BillingInterval } from '../utils/catalog.validators';
import { ForbiddenError, ValidationError } from '../utils/errors';
import { toAmount } from '../utils/money';
import type { Requester } from './requester';

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface FinanceIntervalSlice {
  billingInterval: BillingInterval;
  subscriptions: number;
  mrr: number;
}

export interface OverdueInvoiceDto {
  id: number;
  invoiceNumber: string;
  customerId: number;
  customerName: string;
  customerEmail: string;
  customerCompany: string | null;
  subscriptionNumber: string;
  planName: string;
  issueDate: string;
  dueDate: string;
  daysOverdue: number;
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
}

export interface FinanceFilterEcho {
  startDate: string | null;
  endDate: string | null;
  planId: number | null;
  customerId: number | null;
}

export interface FinanceDashboardDto {
  /** Echoes the applied filters so the UI never labels unfiltered data by mistake. */
  filters: FinanceFilterEcho;
  activeSubscriptions: number;
  mrr: number;
  arr: number;
  totalRevenueCollected: number;
  totalPayments: number;
  totalOutstandingOwed: number;
  openInvoiceCount: number;
  totalOverdueOwed: number;
  overdueInvoiceCount: number;
  mrrByInterval: FinanceIntervalSlice[];
  /** Oldest first — the order the collections team works through them. */
  overdueInvoices: OverdueInvoiceDto[];
  /** Server-side duration of the aggregate queries, in milliseconds. */
  queryTimeMs: number;
  generatedAt: string;
}

export interface FinancePlanOption {
  id: number;
  name: string;
  billingInterval: BillingInterval;
}

export interface FinanceCustomerOption {
  id: number;
  name: string;
  email: string;
  company: string | null;
}

export interface FinanceFilterOptionsDto {
  plans: FinancePlanOption[];
  customers: FinanceCustomerOption[];
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function isInternal(requester: Requester): boolean {
  return requester.role === 'ADMIN' || requester.role === 'STAFF';
}

/**
 * Permission is a business rule, so it lives here as well as in the route
 * middleware: the dashboard exposes every customer's revenue, which is exactly
 * what a customer portal session must never see.
 */
function assertInternal(requester: Requester): void {
  if (!isInternal(requester)) {
    throw new ForbiddenError('The finance dashboard is available to Admin and Staff only.');
  }
}

/** An impossible window would silently return zeros; refuse it with the field. */
function assertDateOrder(filter: FinanceFilter): void {
  if (filter.startDate && filter.endDate && filter.startDate > filter.endDate) {
    throw new ValidationError('The end date must be on or after the start date.', [
      { field: 'endDate', message: 'Choose an end date on or after the start date.' },
    ]);
  }
}

/**
 * Filter ids arrive from a dropdown, but a hand-edited URL can carry any
 * integer. Naming the stale id beats returning a dashboard of zeros.
 */
async function assertFilterTargets(filter: FinanceFilter): Promise<void> {
  const [planOk, customerOk] = await Promise.all([
    filter.planId === undefined ? true : financeRepository.planExists(filter.planId),
    filter.customerId === undefined ? true : financeRepository.customerExists(filter.customerId),
  ]);

  if (!planOk) {
    throw new ValidationError(`No subscription plan exists with id ${filter.planId}.`, [
      { field: 'planId', message: 'Pick a plan from the list.' },
    ]);
  }
  if (!customerOk) {
    throw new ValidationError(`No customer account exists with id ${filter.customerId}.`, [
      { field: 'customerId', message: 'Pick a customer from the list.' },
    ]);
  }
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/**
 * Runs four independent aggregates concurrently: contracts and MRR, the
 * cadence mix, cash collected, and what is still owed. Each is a single
 * statement the planner can satisfy from an index, and all of them round in
 * SQL, so the browser receives finished figures rather than a list of rows to
 * add up.
 */
export async function getDashboard(
  requester: Requester,
  filter: FinanceFilter,
  overdueLimit = 50,
): Promise<FinanceDashboardDto> {
  assertInternal(requester);
  assertDateOrder(filter);
  await assertFilterTargets(filter);

  const startedAt = performance.now();
  const [subscriptions, intervals, revenue, invoices, overdue] = await Promise.all([
    financeRepository.subscriptionTotals(filter),
    financeRepository.mrrByInterval(filter),
    financeRepository.revenueTotals(filter),
    financeRepository.invoiceTotals(filter),
    financeRepository.overdueInvoices(filter, overdueLimit),
  ]);
  const queryTimeMs = Math.round((performance.now() - startedAt) * 10) / 10;

  return {
    filters: {
      startDate: filter.startDate ?? null,
      endDate: filter.endDate ?? null,
      planId: filter.planId ?? null,
      customerId: filter.customerId ?? null,
    },
    activeSubscriptions: subscriptions.active_subscriptions,
    mrr: toAmount(subscriptions.mrr),
    arr: toAmount(subscriptions.arr),
    totalRevenueCollected: toAmount(revenue.collected),
    totalPayments: revenue.total_payments,
    totalOutstandingOwed: toAmount(invoices.outstanding),
    openInvoiceCount: invoices.open_invoices,
    totalOverdueOwed: toAmount(invoices.overdue),
    overdueInvoiceCount: invoices.overdue_invoices,
    mrrByInterval: intervals.map((row) => ({
      billingInterval: row.billing_interval as BillingInterval,
      subscriptions: row.subscriptions,
      mrr: toAmount(row.mrr),
    })),
    overdueInvoices: overdue.map((row) => ({
      id: row.id,
      invoiceNumber: row.invoice_number,
      customerId: row.customer_id,
      customerName: row.customer_name,
      customerEmail: row.customer_email,
      customerCompany: row.customer_company,
      subscriptionNumber: row.subscription_number,
      planName: row.plan_name,
      issueDate: row.issue_date,
      dueDate: row.due_date,
      daysOverdue: row.days_overdue,
      totalAmount: toAmount(row.total_amount),
      amountPaid: toAmount(row.amount_paid),
      balanceDue: toAmount(row.balance_due),
    })),
    queryTimeMs,
    generatedAt: new Date().toISOString(),
  };
}

/** Options for the plan and customer pickers, scoped to real contracts. */
export async function getFilterOptions(
  requester: Requester,
): Promise<FinanceFilterOptionsDto> {
  assertInternal(requester);

  const [plans, customers] = await Promise.all([
    financeRepository.planOptions(),
    financeRepository.customerOptions(),
  ]);

  return {
    plans: plans.map((row) => ({
      id: row.id,
      name: row.name,
      billingInterval: row.billing_interval as BillingInterval,
    })),
    customers: customers.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      company: row.company_name,
    })),
  };
}
