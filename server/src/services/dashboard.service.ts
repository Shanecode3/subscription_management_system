import { performance } from 'node:perf_hooks';
import * as dashboardRepository from '../repositories/dashboard.repository';
import { ForbiddenError } from '../utils/errors';
import { toAmount } from '../utils/money';
import * as billingEngine from './billing.engine';
import type { Requester } from './requester';

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface DashboardStatusCount {
  status: string;
  count: number;
}

export interface DashboardInvoiceStatus extends DashboardStatusCount {
  amount: number;
}

export interface DashboardProductType {
  type: string;
  count: number;
  active: number;
}

export interface DashboardCatalogue {
  products: { total: number; active: number; byType: DashboardProductType[] };
  plans: { total: number; active: number };
  templates: { total: number };
}

export interface DashboardDiscounts {
  total: number;
  active: number;
  usesRemaining: number;
}

export interface DashboardTaxRules {
  total: number;
  active: number;
  /** Rate of the default rule, or 0 when none is marked default. */
  defaultRate: number;
}

export interface DashboardBillingDue {
  subscriptionNumber: string;
  customerName: string;
  nextBillingDate: string;
  totalAmount: number;
}

export interface DashboardBilling {
  dueCount: number;
  dueTotal: number;
  closingCount: number;
  /** The contracts worth showing on the card, largest first. */
  due: DashboardBillingDue[];
}

export interface DashboardSummaryDto {
  invoices: { total: number; byStatus: DashboardInvoiceStatus[] };
  subscriptions: { total: number; byStatus: DashboardStatusCount[] };
  catalogue: DashboardCatalogue;
  discounts: DashboardDiscounts;
  taxRules: DashboardTaxRules;
  billing: DashboardBilling;
  queryTimeMs: number;
  generatedAt: string;
}

/** How many due contracts the summary card has room to name. */
const DUE_PREVIEW_LIMIT = 3;

function assertInternal(requester: Requester): void {
  if (requester.role !== 'ADMIN' && requester.role !== 'STAFF') {
    throw new ForbiddenError('The workspace summary is available to Admin and Staff only.');
  }
}

/** Invoice states read left to right in the order an invoice lives through them. */
const INVOICE_STATUS_ORDER = ['Draft', 'Confirmed', 'Paid', 'Cancelled'];

function statusRank(status: string): number {
  const index = INVOICE_STATUS_ORDER.indexOf(status);
  return index === -1 ? INVOICE_STATUS_ORDER.length : index;
}

/**
 * One round trip's worth of counts for the dashboard's section cards. The
 * catalogue, ledger and billing aggregates are independent, so they run
 * concurrently; the billing figure comes from the same engine that runs
 * Billing Day, which is why the card cannot disagree with the button.
 */
export async function getSummary(requester: Requester): Promise<DashboardSummaryDto> {
  assertInternal(requester);

  const startedAt = performance.now();
  const [
    invoiceStatusRows,
    subscriptionStatusRows,
    productRows,
    plans,
    templates,
    discounts,
    taxes,
    billingPreview,
  ] = await Promise.all([
    dashboardRepository.invoiceStatusTotals(),
    dashboardRepository.subscriptionStatusTotals(),
    dashboardRepository.productTypeTotals(),
    dashboardRepository.planTotals(),
    dashboardRepository.templateTotals(),
    dashboardRepository.discountTotals(),
    dashboardRepository.taxTotals(),
    billingEngine.previewBillingDay(),
  ]);
  const queryTimeMs = Math.round((performance.now() - startedAt) * 10) / 10;

  const invoiceByStatus = invoiceStatusRows
    .map((row) => ({
      status: row.status,
      count: row.count,
      amount: toAmount(row.amount),
    }))
    .sort((a, b) => statusRank(a.status) - statusRank(b.status));

  const productByType = productRows.map((row) => ({
    type: row.type,
    count: row.count,
    active: row.active,
  }));

  const due = [...billingPreview.items]
    .sort((a, b) => b.totalAmount - a.totalAmount || a.nextBillingDate.localeCompare(b.nextBillingDate))
    .slice(0, DUE_PREVIEW_LIMIT)
    .map((item) => ({
      subscriptionNumber: item.subscriptionNumber,
      customerName: item.customerName,
      nextBillingDate: item.nextBillingDate,
      totalAmount: item.totalAmount,
    }));

  return {
    invoices: {
      total: invoiceByStatus.reduce((sum, row) => sum + row.count, 0),
      byStatus: invoiceByStatus,
    },
    subscriptions: {
      total: subscriptionStatusRows.reduce((sum, row) => sum + row.count, 0),
      byStatus: subscriptionStatusRows.map((row) => ({
        status: row.status,
        count: row.count,
      })),
    },
    catalogue: {
      products: {
        total: productByType.reduce((sum, row) => sum + row.count, 0),
        active: productByType.reduce((sum, row) => sum + row.active, 0),
        byType: productByType,
      },
      plans: { total: plans.total, active: plans.active },
      templates: { total: templates.total },
    },
    discounts: {
      total: discounts.total,
      active: discounts.active,
      usesRemaining: discounts.uses_remaining,
    },
    taxRules: {
      total: taxes.total,
      active: taxes.active,
      defaultRate: toAmount(taxes.default_rate),
    },
    billing: {
      dueCount: billingPreview.dueCount,
      dueTotal: billingPreview.dueTotal,
      closingCount: billingPreview.closingCount,
      due,
    },
    queryTimeMs,
    generatedAt: new Date().toISOString(),
  };
}
