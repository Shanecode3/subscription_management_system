import type { PoolClient } from 'pg';
import { withTransaction } from '../db/pool';
import { recordAuditEvent } from '../repositories/audit.repository';
import * as invoiceRepository from '../repositories/invoice.repository';
import * as paymentRepository from '../repositories/payment.repository';
import type { PaymentRow } from '../repositories/payment.repository';
import { todayIso } from '../utils/dates';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { toAmount } from '../utils/money';
import type { RecordPaymentInput } from '../utils/payment.validators';
import type { Requester } from './requester';

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface PaymentDto {
  id: number;
  paymentNumber: string;
  invoiceId: number;
  invoiceNumber: string;
  customerId: number;
  customerName: string;
  amount: number;
  method: string;
  date: string;
  note: string | null;
  recordedBy: number;
  recordedByName: string;
  createdAt: string;
}

/**
 * What the invoice looks like *after* this payment. It is a summary rather than
 * a full invoice document: the screen refetches the invoice anyway, and keeping
 * the shape local avoids a circular import between the two services.
 */
export interface ReconciliationDto {
  invoiceId: number;
  invoiceNumber: string;
  status: string;
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
  fullyPaid: boolean;
}

export interface RecordPaymentResultDto {
  payment: PaymentDto;
  reconciliation: ReconciliationDto;
}

export interface PaymentFilterInput {
  invoiceId?: number;
  customerId?: number;
  from?: string;
  to?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Row -> DTO
// ---------------------------------------------------------------------------

export function toPaymentDto(row: PaymentRow): PaymentDto {
  return {
    id: row.id,
    paymentNumber: row.payment_number,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    customerId: row.customer_id,
    customerName: row.customer_name,
    amount: toAmount(row.amount),
    method: row.payment_method,
    date: row.payment_date,
    note: row.reference_note,
    recordedBy: row.recorded_by,
    recordedByName: row.recorded_by_name,
    createdAt: row.created_at.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const toCents = (amount: number): number => Math.round(amount * 100);
const money = (amount: number): string => `$${amount.toFixed(2)}`;

function isInternal(requester: Requester): boolean {
  return requester.role === 'ADMIN' || requester.role === 'STAFF';
}

/** Every business rejection names the field it concerns, for the form. */
function reject(message: string, field: string): never {
  throw new ValidationError(message, [{ field, message }]);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * A customer session is forced onto its own customer id, exactly as the invoice
 * list does: `?customerId=` from a customer cannot widen the result.
 */
export async function listPayments(
  requester: Requester,
  filter: PaymentFilterInput,
): Promise<PaymentDto[]> {
  const customerId = isInternal(requester) ? filter.customerId : requester.id;

  const rows = await paymentRepository.listPayments({
    invoiceId: filter.invoiceId,
    customerId,
    from: filter.from,
    to: filter.to,
    limit: filter.limit,
  });

  return rows.map(toPaymentDto);
}

/** Payment history for one invoice, already tenant-checked by the invoice read. */
export async function paymentsForInvoice(
  invoiceId: number,
  client?: PoolClient,
): Promise<PaymentDto[]> {
  const rows = await paymentRepository.listPaymentsForInvoice(invoiceId, client);
  return rows.map(toPaymentDto);
}

// ---------------------------------------------------------------------------
// Recording a payment
// ---------------------------------------------------------------------------

/**
 * Records one payment and reconciles the invoice in the same transaction.
 *
 * The reasons are deliberately checked in this order: existence, permission,
 * invoice state, then the amount and date. Each rejection is something the
 * clerk can act on, and none of them can leave a payment row behind without the
 * matching `invoices.amount_paid` update — either both commits happen or neither
 * does.
 */
export async function recordPayment(
  input: RecordPaymentInput,
  requester: Requester,
): Promise<RecordPaymentResultDto> {
  if (!isInternal(requester)) {
    throw new ForbiddenError('Only internal staff can record payments.');
  }

  return withTransaction(async (client) => {
    // Lock first: a second clerk paying the same invoice waits here, then sees
    // the updated amount_paid instead of overpaying against a stale balance.
    const locked = await invoiceRepository.lockInvoice(input.invoiceId, client);
    if (!locked) throw new NotFoundError('That invoice does not exist.');

    const invoice = await invoiceRepository.findInvoiceById(input.invoiceId, client);
    if (!invoice) throw new NotFoundError('That invoice does not exist.');

    if (invoice.status === 'Draft') {
      reject(
        `Invoice ${invoice.invoice_number} is still a draft. Confirm it before recording a payment.`,
        'status',
      );
    }
    if (invoice.status === 'Cancelled') {
      reject(
        `Invoice ${invoice.invoice_number} was cancelled, so it cannot receive a payment.`,
        'status',
      );
    }
    if (invoice.status === 'Paid') {
      reject(`Invoice ${invoice.invoice_number} is already fully paid.`, 'status');
    }

    const today = todayIso();
    if (input.date > today) {
      reject(`Payment date cannot be in the future. Use ${today} or an earlier date.`, 'date');
    }
    if (input.date < invoice.issue_date) {
      reject(
        `Payment date cannot be earlier than the invoice issue date (${invoice.issue_date}).`,
        'date',
      );
    }

    const totalAmount = toAmount(invoice.total_amount);
    const previouslyPaid = toAmount(invoice.amount_paid);
    const outstanding = toCents(totalAmount) - toCents(previouslyPaid);

    if (toCents(input.amount) > outstanding) {
      reject(
        `A payment of ${money(input.amount)} exceeds the ${money(outstanding / 100)} still outstanding on invoice ${invoice.invoice_number}.`,
        'amount',
      );
    }

    const inserted = await paymentRepository.insertPayment(
      {
        invoiceId: invoice.id,
        // Copied from the invoice, never taken from the request body, so a
        // payment can never be attributed to another customer.
        customerId: invoice.customer_id,
        amount: input.amount,
        method: input.method,
        date: input.date,
        note: input.note && input.note.trim() !== '' ? input.note.trim() : null,
        recordedBy: requester.id,
      },
      client,
    );

    const applied = await invoiceRepository.applyPayment(invoice.id, input.amount, client);
    const amountPaid = toAmount(applied.amount_paid);
    const fullyPaid = applied.status === 'Paid';

    const paymentRow = await paymentRepository.findPaymentById(inserted.id, client);
    if (!paymentRow) throw new NotFoundError('That payment does not exist.');

    await recordAuditEvent(
      {
        entityType: 'PAYMENT',
        entityId: inserted.id,
        action: 'PAYMENT_RECORDED',
        performedBy: requester.id,
        details: {
          paymentNumber: inserted.payment_number,
          invoiceNumber: invoice.invoice_number,
          amount: input.amount,
          method: input.method,
          date: input.date,
          balanceDue: toAmount(Math.max(toAmount(applied.total_amount) - amountPaid, 0)),
        },
      },
      client,
    );

    if (fullyPaid) {
      await recordAuditEvent(
        {
          entityType: 'INVOICE',
          entityId: invoice.id,
          action: 'INVOICE_PAID',
          performedBy: requester.id,
          details: {
            invoiceNumber: invoice.invoice_number,
            totalAmount,
            amountPaid,
            settledBy: inserted.payment_number,
          },
        },
        client,
      );
    }

    return {
      payment: toPaymentDto(paymentRow),
      reconciliation: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        status: applied.status,
        totalAmount,
        amountPaid,
        balanceDue: toAmount(Math.max(toAmount(applied.total_amount) - amountPaid, 0)),
        fullyPaid,
      },
    };
  });
}

export function paymentMessage(payment: PaymentDto, fullyPaid: boolean): string {
  return fullyPaid
    ? `${payment.paymentNumber} recorded. Invoice ${payment.invoiceNumber} is now fully paid.`
    : `${payment.paymentNumber} recorded.`;
}
