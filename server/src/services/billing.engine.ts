import type { PoolClient } from 'pg';
import { withTransaction } from '../db/pool';
import { recordAuditEvent } from '../repositories/audit.repository';
import * as invoiceRepository from '../repositories/invoice.repository';
import * as subscriptionRepository from '../repositories/subscription.repository';
import * as taxRepository from '../repositories/tax.repository';
import type { TaxRuleRow } from '../repositories/tax.repository';
import type {
  BillingLockRow,
  SubscriptionLineRow,
} from '../repositories/subscription.repository';
import type { BillingInterval } from '../utils/catalog.validators';
import { dueDateFor, todayIso } from '../utils/dates';
import { AppError } from '../utils/errors';
import { toAmount } from '../utils/money';
import {
  claimDiscountUse,
  detachDiscountRule,
  listApplicableDiscounts,
  rankApplicableDiscounts,
  type DiscountComputation,
} from './discount.service';
import type { Requester } from './requester';

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface BillingDueItemDto {
  subscriptionId: number;
  subscriptionNumber: string;
  customerId: number;
  customerName: string;
  customerEmail: string;
  planName: string;
  billingInterval: BillingInterval;
  paymentTerms: string;
  nextBillingDate: string;
  expiryDate: string | null;
  lineCount: number;
  subtotal: number;
  discountAmount: number;
  discountCode: string | null;
  discountName: string | null;
  taxName: string | null;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  closesOnExpiry: boolean;
}

export interface BillingClosingItemDto {
  subscriptionId: number;
  subscriptionNumber: string;
  expiryDate: string;
}

export interface BillingPreviewDto {
  asOf: string;
  dueCount: number;
  dueTotal: number;
  items: BillingDueItemDto[];
  closingCount: number;
  closing: BillingClosingItemDto[];
}

export interface BillingInvoiceSummaryDto {
  invoiceId: number;
  invoiceNumber: string;
  subscriptionId: number;
  subscriptionNumber: string;
  customerName: string;
  subtotal: number;
  discountTotal: number;
  discountCode: string | null;
  taxTotal: number;
  totalAmount: number;
}

export interface BillingSkippedDto {
  subscriptionId: number;
  subscriptionNumber: string;
  reason: string;
}

export interface BillingFailureDto {
  subscriptionId: number;
  subscriptionNumber: string;
  message: string;
}

export interface BillingRunResultDto {
  ranAt: string;
  totalEvaluated: number;
  generatedCount: number;
  skippedCount: number;
  failedCount: number;
  closedCount: number;
  invoices: BillingInvoiceSummaryDto[];
  skipped: BillingSkippedDto[];
  failures: BillingFailureDto[];
  closed: BillingClosingItemDto[];
}

// ---------------------------------------------------------------------------
// Amount arithmetic — integer cents, so 18% of 1,199.99 never drifts
// ---------------------------------------------------------------------------

const toCents = (amount: number): number => Math.round(amount * 100);
const fromCents = (cents: number): number => cents / 100;

interface EvaluatedLine {
  source: SubscriptionLineRow;
  amountCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}

interface EvaluatedInvoice {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  lines: EvaluatedLine[];
  taxRule: TaxRuleRow | null;
}

/** Only add-ons that are switched on are billable. */
function billableLines(lines: SubscriptionLineRow[]): SubscriptionLineRow[] {
  return lines.filter((line) => !line.is_addon || line.is_addon_active);
}

function evaluateInvoice(
  lines: SubscriptionLineRow[],
  discount: DiscountComputation | null,
  taxRule: TaxRuleRow | null,
): EvaluatedInvoice {
  const taxRate = taxRule ? toAmount(taxRule.rate) : 0;

  const evaluatedLines = lines.map((source, index) => {
    const amountCents = toCents(toAmount(source.unit_price)) * source.quantity;
    const discountCents = Math.min(
      Math.round((discount?.perLine[index] ?? 0) * 100),
      amountCents,
    );
    const taxableCents = Math.max(amountCents - discountCents, 0);
    // The rate is snapshotted onto the invoice line, so a later change to the
    // tax rule cannot rewrite an invoice that was already issued.
    const taxCents = Math.round((taxableCents * taxRate) / 100);

    return {
      source,
      amountCents,
      discountCents,
      taxCents,
      totalCents: taxableCents + taxCents,
    };
  });

  return {
    subtotalCents: evaluatedLines.reduce((sum, line) => sum + line.amountCents, 0),
    discountCents: evaluatedLines.reduce((sum, line) => sum + line.discountCents, 0),
    taxCents: evaluatedLines.reduce((sum, line) => sum + line.taxCents, 0),
    totalCents: evaluatedLines.reduce((sum, line) => sum + line.totalCents, 0),
    lines: evaluatedLines,
    taxRule,
  };
}

function discountLineInputs(lines: SubscriptionLineRow[]) {
  return lines.map((line) => ({
    productId: line.product_id,
    quantity: line.quantity,
    unitPrice: toAmount(line.unit_price),
  }));
}

/** The tax rule a contract pays: its own active assignment, else the default. */
function effectiveTaxRule(
  assignedRuleId: number | null,
  byId: Map<number, TaxRuleRow>,
  defaultRule: TaxRuleRow | null,
): TaxRuleRow | null {
  if (assignedRuleId !== null) {
    const assigned = byId.get(assignedRuleId);
    if (assigned && assigned.is_active) return assigned;
  }
  return defaultRule;
}

function indexTaxRules(rows: TaxRuleRow[]): {
  byId: Map<number, TaxRuleRow>;
  defaultRule: TaxRuleRow | null;
} {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const defaultRule = rows.find((row) => row.is_default && row.is_active) ?? null;
  return { byId, defaultRule };
}

function groupLinesBySubscription(rows: SubscriptionLineRow[]): Map<number, SubscriptionLineRow[]> {
  const grouped = new Map<number, SubscriptionLineRow[]>();
  for (const row of rows) {
    const bucket = grouped.get(row.subscription_id);
    if (bucket) bucket.push(row);
    else grouped.set(row.subscription_id, [row]);
  }
  return grouped;
}

// ---------------------------------------------------------------------------
// Preview — what the next run would do, without writing anything
// ---------------------------------------------------------------------------

export async function previewBillingDay(): Promise<BillingPreviewDto> {
  const [dueRows, expiredRows, taxRows, candidateRules] = await Promise.all([
    subscriptionRepository.listDueSubscriptions(),
    subscriptionRepository.listExpiredAutoCloseSubscriptions(),
    taxRepository.listTaxRules(false),
    listApplicableDiscounts(),
  ]);

  const lines = await subscriptionRepository.listLinesForSubscriptions(
    dueRows.map((row) => row.id),
  );
  const linesBySubscription = groupLinesBySubscription(lines);
  const { byId, defaultRule } = indexTaxRules(taxRows);

  const items: BillingDueItemDto[] = dueRows.map((row) => {
    const billable = billableLines(linesBySubscription.get(row.id) ?? []);
    const lineInputs = discountLineInputs(billable);
    const best = billable.length > 0 ? rankApplicableDiscounts(candidateRules, lineInputs)[0] : undefined;
    const evaluated = evaluateInvoice(billable, best ?? null, effectiveTaxRule(row.tax_rule_id, byId, defaultRule));

    return {
      subscriptionId: row.id,
      subscriptionNumber: row.subscription_number,
      customerId: row.customer_id,
      customerName: row.customer_name,
      customerEmail: row.customer_email,
      planName: row.plan_name,
      billingInterval: row.billing_interval,
      paymentTerms: row.payment_terms,
      nextBillingDate: row.next_billing_date ?? row.start_date,
      expiryDate: row.expiry_date,
      lineCount: billable.length,
      subtotal: fromCents(evaluated.subtotalCents),
      discountAmount: fromCents(evaluated.discountCents),
      discountCode: best?.rule.code ?? null,
      discountName: best?.rule.name ?? null,
      taxName: evaluated.taxRule?.name ?? null,
      taxRate: evaluated.taxRule ? toAmount(evaluated.taxRule.rate) : 0,
      taxAmount: fromCents(evaluated.taxCents),
      totalAmount: fromCents(evaluated.totalCents),
      closesOnExpiry: row.auto_close,
    };
  });

  return {
    asOf: todayIso(),
    dueCount: items.length,
    dueTotal: fromCents(items.reduce((sum, item) => sum + toCents(item.totalAmount), 0)),
    items,
    closingCount: expiredRows.length,
    closing: expiredRows.map((row) => ({
      subscriptionId: row.id,
      subscriptionNumber: row.subscription_number,
      expiryDate: row.expiry_date,
    })),
  };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

type BillingOutcome =
  | {
      kind: 'generated';
      invoice: BillingInvoiceSummaryDto;
      autoClosed: BillingClosingItemDto | null;
    }
  | { kind: 'skipped'; reason: string };

interface RunContext {
  requester: Requester;
  today: string;
  taxRows: TaxRuleRow[];
}

async function billOne(subscriptionId: number, context: RunContext): Promise<BillingOutcome> {
  return withTransaction(async (client: PoolClient): Promise<BillingOutcome> => {
    const locked = await subscriptionRepository.lockSubscriptionForBilling(subscriptionId, client);
    if (!locked) {
      return { kind: 'skipped', reason: 'Subscription no longer exists.' };
    }
    if (locked.status !== 'Active') {
      return { kind: 'skipped', reason: `Subscription is now ${locked.status}.` };
    }
    if (!locked.next_billing_date || locked.next_billing_date > context.today) {
      return { kind: 'skipped', reason: 'Not due on this run date.' };
    }

    const cycleDate = locked.next_billing_date;
    const cycleKey = `sub_${locked.id}_${cycleDate}`;

    // Belt and braces: the unique constraint is the final guard, but checking
    // first avoids consuming a discount for an invoice we will not create.
    const alreadyBilled = await invoiceRepository.findInvoiceByCycleKey(cycleKey, client);
    if (alreadyBilled) {
      return {
        kind: 'skipped',
        reason: `Already invoiced as ${alreadyBilled.invoice_number} for this cycle.`,
      };
    }

    const lines = billableLines(
      await subscriptionRepository.listLinesForSubscription(locked.id, client),
    );
    if (lines.length === 0) {
      return { kind: 'skipped', reason: 'No billable lines on this contract.' };
    }

    const lineInputs = discountLineInputs(lines);
    const ranked = rankApplicableDiscounts(
      await listApplicableDiscounts(client),
      lineInputs,
    );

    // Claim the first rule whose usage can still be taken. The claim is an
    // atomic UPDATE ... WHERE current_uses < max_uses, so a race simply moves
    // on to the next-best rule instead of overshooting the cap.
    let chosen: DiscountComputation | null = null;
    let claimedLimit: { currentUses: number; maxUses: number } | null = null;
    for (const candidate of ranked) {
      const claim = await claimDiscountUse(candidate.rule.id, client);
      if (claim) {
        chosen = candidate;
        claimedLimit = claim;
        break;
      }
    }

    const taxRule = await resolveTaxRule(locked, context.taxRows, client);
    const evaluated = evaluateInvoice(lines, chosen, taxRule);

    const issueDate = context.today;
    const dueDate = dueDateFor(locked.payment_terms, issueDate);
    const inserted = await invoiceRepository.insertInvoice(
      {
        subscriptionId: locked.id,
        customerId: locked.customer_id,
        billingCycleDate: cycleDate,
        billingCycleKey: cycleKey,
        issueDate,
        dueDate,
        subtotal: fromCents(evaluated.subtotalCents),
        taxTotal: fromCents(evaluated.taxCents),
        discountTotal: fromCents(evaluated.discountCents),
        totalAmount: fromCents(evaluated.totalCents),
        notes: null,
      },
      client,
    );

    await invoiceRepository.insertInvoiceLines(
      inserted.id,
      evaluated.lines.map((line) => ({
        productId: line.source.product_id,
        variantId: line.source.variant_id,
        description: line.source.description,
        quantity: line.source.quantity,
        unitPrice: toAmount(line.source.unit_price),
        discountAmount: fromCents(line.discountCents),
        taxAmount: fromCents(line.taxCents),
        totalAmount: fromCents(line.totalCents),
        taxRuleId: evaluated.taxRule?.id ?? null,
        taxName: evaluated.taxRule?.name ?? null,
        taxRate: evaluated.taxRule ? toAmount(evaluated.taxRule.rate) : 0,
        discountRuleId: line.discountCents > 0 ? (chosen?.rule.id ?? null) : null,
      })),
      client,
    );

    const nextBillingDate = await subscriptionRepository.advanceBillingCycle(
      locked.id,
      locked.billing_interval,
      chosen?.rule.id ?? null,
      client,
    );

    // A rule that just used its last allowance can never discount again, so it
    // is cleared from every contract still pointing at it — including this one,
    // which the advance step would otherwise have re-attached. The invoice that
    // was just written keeps its own snapshot, so its figures do not change.
    if (chosen && claimedLimit && claimedLimit.currentUses >= claimedLimit.maxUses) {
      await detachDiscountRule(chosen.rule.id, client);
    }

    // Auto-close: the next cycle would start after the contract ended, so this
    // invoice is the last one the customer will ever receive.
    let autoClosed: BillingClosingItemDto | null = null;
    if (
      locked.auto_close &&
      locked.expiry_date !== null &&
      nextBillingDate !== null &&
      nextBillingDate > locked.expiry_date
    ) {
      await subscriptionRepository.updateSubscription(
        locked.id,
        { status: 'Closed', closedAt: new Date() },
        client,
      );
      autoClosed = {
        subscriptionId: locked.id,
        subscriptionNumber: locked.subscription_number,
        expiryDate: locked.expiry_date,
      };
      await recordAuditEvent(
        {
          entityType: 'SUBSCRIPTION',
          entityId: locked.id,
          action: 'SUBSCRIPTION_AUTO_CLOSED',
          performedBy: context.requester.id,
          details: {
            subscriptionNumber: locked.subscription_number,
            expiryDate: locked.expiry_date,
            nextBillingDate,
            reason: 'auto_close plan reached its expiry date',
          },
        },
        client,
      );
    }

    await recordAuditEvent(
      {
        entityType: 'INVOICE',
        entityId: inserted.id,
        action: 'INVOICE_GENERATED',
        performedBy: context.requester.id,
        details: {
          invoiceNumber: inserted.invoice_number,
          subscriptionId: locked.id,
          subscriptionNumber: locked.subscription_number,
          billingCycleKey: cycleKey,
          subtotal: fromCents(evaluated.subtotalCents),
          discount: chosen ? { code: chosen.rule.code, amount: chosen.amount } : null,
          tax: { name: evaluated.taxRule?.name ?? null, amount: fromCents(evaluated.taxCents) },
          total: fromCents(evaluated.totalCents),
        },
      },
      client,
    );

    return {
      kind: 'generated',
      invoice: {
        invoiceId: inserted.id,
        invoiceNumber: inserted.invoice_number,
        subscriptionId: locked.id,
        subscriptionNumber: locked.subscription_number,
        customerName: locked.customer_name,
        subtotal: fromCents(evaluated.subtotalCents),
        discountTotal: fromCents(evaluated.discountCents),
        discountCode: chosen?.rule.code ?? null,
        taxTotal: fromCents(evaluated.taxCents),
        totalAmount: fromCents(evaluated.totalCents),
      },
      autoClosed,
    };
  });
}

async function resolveTaxRule(
  locked: BillingLockRow,
  taxRows: TaxRuleRow[],
  client: PoolClient,
): Promise<TaxRuleRow | null> {
  const { byId, defaultRule } = indexTaxRules(taxRows);
  if (locked.tax_rule_id !== null) {
    const assigned = byId.get(locked.tax_rule_id) ?? (await taxRepository.findTaxRuleById(locked.tax_rule_id, client));
    if (assigned && assigned.is_active) return assigned;
  }
  return defaultRule;
}

/**
 * One click, every due contract, and no way to bill a cycle twice.
 *
 * Each subscription is processed in its own transaction so one bad contract
 * cannot roll back the whole run, while the UNIQUE(billing_cycle_key) constraint
 * remains the final, database-level guarantee of idempotency: even two runs
 * racing each other can produce at most one invoice per subscription cycle.
 */
export async function runBillingDay(requester: Requester): Promise<BillingRunResultDto> {
  const today = todayIso();

  // Pass 1: close contracts whose plan auto-closes and whose expiry has passed,
  // before they can be billed again.
  const closed = await withTransaction(async (client) => {
    const rows = await subscriptionRepository.closeExpiredAutoCloseSubscriptions(client);
    for (const row of rows) {
      await recordAuditEvent(
        {
          entityType: 'SUBSCRIPTION',
          entityId: row.id,
          action: 'SUBSCRIPTION_AUTO_CLOSED',
          performedBy: requester.id,
          details: {
            subscriptionNumber: row.subscription_number,
            expiryDate: row.expiry_date,
            reason: 'auto_close plan reached its expiry date',
          },
        },
        client,
      );
    }
    return rows.map((row) => ({
      subscriptionId: row.id,
      subscriptionNumber: row.subscription_number,
      expiryDate: row.expiry_date,
    }));
  });

  const dueRows = await subscriptionRepository.listDueSubscriptions();
  const taxRows = await taxRepository.listTaxRules(false);
  const context: RunContext = { requester, today, taxRows };

  const invoices: BillingInvoiceSummaryDto[] = [];
  const skipped: BillingSkippedDto[] = [];
  const failures: BillingFailureDto[] = [];
  const autoClosedDuringBilling: BillingClosingItemDto[] = [];

  for (const row of dueRows) {
    try {
      const outcome = await billOne(row.id, context);
      if (outcome.kind === 'generated') {
        invoices.push(outcome.invoice);
        if (outcome.autoClosed) autoClosedDuringBilling.push(outcome.autoClosed);
      } else {
        skipped.push({
          subscriptionId: row.id,
          subscriptionNumber: row.subscription_number,
          reason: outcome.reason,
        });
      }
    } catch (error) {
      // 23505 = unique_violation. The billing_cycle_key constraint caught a
      // concurrent run that billed this cycle first; that is a skip, not an error.
      if ((error as { code?: string }).code === '23505') {
        skipped.push({
          subscriptionId: row.id,
          subscriptionNumber: row.subscription_number,
          reason: 'This billing cycle was already invoiced by another run.',
        });
        continue;
      }

      failures.push({
        subscriptionId: row.id,
        subscriptionNumber: row.subscription_number,
        message:
          error instanceof AppError
            ? error.message
            : 'An unexpected error stopped this invoice. The rest of the run continued.',
      });
    }
  }

  const allClosed = [...closed, ...autoClosedDuringBilling];

  return {
    ranAt: new Date().toISOString(),
    totalEvaluated: dueRows.length + closed.length,
    generatedCount: invoices.length,
    skippedCount: skipped.length,
    failedCount: failures.length,
    closedCount: allClosed.length,
    invoices,
    skipped,
    failures,
    closed: allClosed,
  };
}
