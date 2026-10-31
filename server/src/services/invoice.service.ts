import type { PoolClient } from 'pg';
import { withTransaction } from '../db/pool';
import { recordAuditEvent } from '../repositories/audit.repository';
import * as invoiceRepository from '../repositories/invoice.repository';
import type {
  InvoiceLineRow,
  InvoicePatch,
  InvoiceRow,
} from '../repositories/invoice.repository';
import type { InvoiceAction, InvoiceStatus } from '../utils/billing.validators';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { toAmount } from '../utils/money';
import type { Requester } from './requester';

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface InvoiceLineDto {
  id: number;
  productId: number;
  productName: string;
  variantId: number | null;
  variantLabel: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  taxName: string | null;
  taxRate: number;
  discountCode: string | null;
}

export interface InvoiceDto {
  id: number;
  invoiceNumber: string;
  subscriptionId: number;
  subscriptionNumber: string;
  customerId: number;
  customerName: string;
  customerEmail: string;
  customerCompany: string | null;
  customerAddress: string | null;
  planName: string;
  paymentTerms: string;
  billingCycleDate: string;
  billingCycleKey: string;
  status: InvoiceStatus;
  issueDate: string;
  dueDate: string;
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
  isOverdue: boolean;
  daysOverdue: number;
  sentAt: string | null;
  cancelledAt: string | null;
  notes: string | null;
  /** Actions this invoice may still receive, computed from its status. */
  allowedActions: InvoiceAction[];
  lines: InvoiceLineDto[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Invoice state machine
// ---------------------------------------------------------------------------

/**
 * Which action each state accepts. There is no "un-cancel": a cancelled
 * invoice stays cancelled so the ledger remains auditable, and a copy can still
 * be printed. `Paid` becomes reachable in the payment milestone; it is listed
 * here so the UI does not need to change when that lands.
 */
const ACTION_STATES: Record<InvoiceAction, InvoiceStatus[]> = {
  confirm: ['Draft'],
  send: ['Draft', 'Confirmed'],
  cancel: ['Draft', 'Confirmed'],
  print: ['Draft', 'Confirmed', 'Paid', 'Cancelled'],
};

const ACTION_ORDER: InvoiceAction[] = ['confirm', 'send', 'cancel', 'print'];

export function allowedActionsFor(status: InvoiceStatus): InvoiceAction[] {
  return ACTION_ORDER.filter((action) => ACTION_STATES[action].includes(status));
}

const ACTION_MESSAGE: Record<InvoiceAction, string> = {
  confirm: 'Invoice confirmed.',
  send: 'Invoice marked as sent.',
  cancel: 'Invoice cancelled.',
  print: 'Invoice ready to print.',
};

const ACTION_AUDIT: Record<InvoiceAction, string> = {
  confirm: 'INVOICE_CONFIRMED',
  send: 'INVOICE_SENT',
  cancel: 'INVOICE_CANCELLED',
  print: 'INVOICE_PRINTED',
};

// ---------------------------------------------------------------------------
// Row -> DTO
// ---------------------------------------------------------------------------

function toLineDto(row: InvoiceLineRow): InvoiceLineDto {
  const variantLabel =
    row.variant_attribute_name && row.variant_attribute_value
      ? `${row.variant_attribute_name}: ${row.variant_attribute_value}`
      : null;

  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    variantId: row.variant_id,
    variantLabel,
    description: row.description,
    quantity: row.quantity,
    unitPrice: toAmount(row.unit_price),
    discountAmount: toAmount(row.discount_amount),
    taxAmount: toAmount(row.tax_amount),
    totalAmount: toAmount(row.total_amount),
    taxName: row.tax_name,
    taxRate: toAmount(row.tax_rate),
    discountCode: row.discount_code,
  };
}

export function toInvoiceDto(row: InvoiceRow, lines: InvoiceLineRow[]): InvoiceDto {
  const totalAmount = toAmount(row.total_amount);
  const amountPaid = toAmount(row.amount_paid);

  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    subscriptionId: row.subscription_id,
    subscriptionNumber: row.subscription_number,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerCompany: row.customer_company,
    customerAddress: row.customer_address,
    planName: row.plan_name,
    paymentTerms: row.payment_terms,
    billingCycleDate: row.billing_cycle_date,
    billingCycleKey: row.billing_cycle_key,
    status: row.status,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    subtotal: toAmount(row.subtotal),
    taxTotal: toAmount(row.tax_total),
    discountTotal: toAmount(row.discount_total),
    totalAmount,
    amountPaid,
    balanceDue: toAmount(Math.max(totalAmount - amountPaid, 0)),
    isOverdue: row.is_overdue,
    daysOverdue: Number(row.days_overdue),
    sentAt: row.sent_at ? row.sent_at.toISOString() : null,
    cancelledAt: row.cancelled_at ? row.cancelled_at.toISOString() : null,
    notes: row.notes,
    allowedActions: allowedActionsFor(row.status),
    lines: lines.map(toLineDto),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

function isInternal(requester: Requester): boolean {
  return requester.role === 'ADMIN' || requester.role === 'STAFF';
}

/**
 * A customer may only ever read their own invoice. The response is 404, not
 * 403, so an id belonging to another tenant is indistinguishable from one that
 * does not exist.
 */
function assertVisible(row: InvoiceRow, requester: Requester): void {
  if (!isInternal(requester) && row.customer_id !== requester.id) {
    throw new NotFoundError('That invoice does not exist.');
  }
}

function assertInternal(requester: Requester, message: string): void {
  if (!isInternal(requester)) {
    throw new ForbiddenError(message);
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listInvoices(
  requester: Requester,
  filter: { status?: InvoiceStatus; customerId?: number; from?: string; to?: string; limit?: number },
): Promise<InvoiceDto[]> {
  // The tenant rule is applied here, never trusted from the query string.
  const customerId = isInternal(requester) ? filter.customerId : requester.id;

  const rows = await invoiceRepository.listInvoices({
    customerId,
    status: filter.status,
    from: filter.from,
    to: filter.to,
    limit: filter.limit,
  });

  // The list does not carry lines: the table shows header figures only, and
  // loading every line of a hundred invoices would be wasted work.
  return rows.map((row) => toInvoiceDto(row, []));
}

async function reload(id: number, client: PoolClient): Promise<InvoiceDto> {
  const row = await invoiceRepository.findInvoiceById(id, client);
  if (!row) throw new NotFoundError('That invoice does not exist.');
  const lines = await invoiceRepository.listLinesForInvoice(id, client);
  return toInvoiceDto(row, lines);
}

export async function getInvoice(id: number, requester: Requester): Promise<InvoiceDto> {
  const row = await invoiceRepository.findInvoiceById(id);
  if (!row) throw new NotFoundError('That invoice does not exist.');
  assertVisible(row, requester);

  const lines = await invoiceRepository.listLinesForInvoice(id);
  return toInvoiceDto(row, lines);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function rejectionMessage(action: InvoiceAction, status: InvoiceStatus): string {
  switch (action) {
    case 'confirm':
      return status === 'Confirmed'
        ? 'This invoice is already confirmed.'
        : `A ${status.toLowerCase()} invoice cannot be confirmed.`;
    case 'send':
      return `A ${status.toLowerCase()} invoice cannot be sent.`;
    case 'cancel':
      return status === 'Paid'
        ? 'A paid invoice cannot be cancelled.'
        : `A ${status.toLowerCase()} invoice cannot be cancelled.`;
    default:
      return `A ${status.toLowerCase()} invoice cannot be printed.`;
  }
}

function patchForAction(
  action: InvoiceAction,
  row: InvoiceRow,
  note: string | undefined,
): InvoicePatch {
  const patch: InvoicePatch = {};

  if (action === 'confirm') patch.status = 'Confirmed';
  if (action === 'cancel') {
    patch.status = 'Cancelled';
    patch.cancelledAt = new Date();
  }
  if (action === 'send') patch.sentAt = new Date();

  if (note && note.trim() !== '') {
    const trimmed = note.trim();
    patch.notes = row.notes ? `${row.notes}\n${trimmed}` : trimmed;
  }

  return patch;
}

/**
 * One endpoint per action, but one implementation. The lock, the state check,
 * the write and the audit row happen in one transaction, so two people pressing
 * Confirm at the same time cannot both succeed.
 */
export async function performInvoiceAction(
  id: number,
  action: InvoiceAction,
  requester: Requester,
  note?: string,
): Promise<InvoiceDto> {
  assertInternal(requester, 'Only internal staff can act on invoices.');

  return withTransaction(async (client) => {
    const locked = await invoiceRepository.lockInvoice(id, client);
    if (!locked) throw new NotFoundError('That invoice does not exist.');

    const row = await invoiceRepository.findInvoiceById(id, client);
    if (!row) throw new NotFoundError('That invoice does not exist.');

    if (!ACTION_STATES[action].includes(row.status)) {
      throw new ValidationError(rejectionMessage(action, row.status), [
        { field: 'status', message: rejectionMessage(action, row.status) },
      ]);
    }

    const patch = patchForAction(action, row, note);
    if (Object.keys(patch).length > 0) {
      await invoiceRepository.updateInvoice(id, patch, client);
    }

    await recordAuditEvent(
      {
        entityType: 'INVOICE',
        entityId: id,
        action: ACTION_AUDIT[action],
        performedBy: requester.id,
        details: {
          invoiceNumber: row.invoice_number,
          from: row.status,
          to: patch.status ?? row.status,
          ...(note && note.trim() !== '' ? { note: note.trim() } : {}),
        },
      },
      client,
    );

    return reload(id, client);
  });
}

export function actionMessage(action: InvoiceAction): string {
  return ACTION_MESSAGE[action];
}
