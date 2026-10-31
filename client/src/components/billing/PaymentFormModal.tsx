import { useEffect, useState } from 'react';
import { ApiError, apiRequest } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { formatMoney, parseAmountInput, todayIso } from '../../lib/format';
import { PAYMENT_METHODS, PAYMENT_METHOD_HINT } from '../../lib/payment-method';
import type { Invoice, PaymentMethod, RecordPaymentResult } from '../../lib/types';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { SelectField } from '../ui/SelectField';
import { TextField } from '../ui/TextField';

interface PaymentFormModalProps {
  open: boolean;
  invoice: Invoice;
  onClose: () => void;
  onRecorded: (result: RecordPaymentResult, message: string | undefined) => void;
}

/**
 * Records one payment against one invoice.
 *
 * The amount defaults to the full outstanding balance, which is what a clerk
 * settles nine times out of ten; a partial amount is just an edit away. Every
 * rule the server enforces is checked here first so the message appears under
 * the field that is wrong rather than in a banner.
 */
export function PaymentFormModal({ open, invoice, onClose, onRecorded }: PaymentFormModalProps) {
  const { token } = useAuth();

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('Bank Transfer');
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState('');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    // Prefilling the balance means the common case is one click, while a short
    // payment simply overwrites the number.
    setAmount(invoice.balanceDue > 0 ? invoice.balanceDue.toFixed(2) : '');
    setMethod('Bank Transfer');
    setDate(todayIso());
    setNote('');
    setFieldErrors({});
    setSubmitError(null);
  }, [open, invoice]);

  const validate = (): Record<string, string> => {
    const errors: Record<string, string> = {};

    const parsedAmount = parseAmountInput(amount);
    if (parsedAmount === null) {
      errors.amount = 'Enter the amount received.';
    } else if (parsedAmount <= 0) {
      errors.amount = 'Payment amount must be greater than zero.';
    } else if (Math.abs(parsedAmount * 100 - Math.round(parsedAmount * 100)) > 1e-6) {
      errors.amount = 'Use at most two decimal places.';
    } else if (parsedAmount > invoice.balanceDue + 0.004) {
      errors.amount = `That is more than the ${formatMoney(invoice.balanceDue)} still outstanding.`;
    }

    if (date === '') {
      errors.date = 'Choose the date the payment was received.';
    } else if (date > todayIso()) {
      errors.date = 'Payment date cannot be in the future.';
    } else if (date < invoice.issueDate) {
      errors.date = `Use ${invoice.issueDate} or later — the invoice was issued that day.`;
    }

    if (note.trim().length > 2000) {
      errors.note = 'Notes must be 2000 characters or fewer.';
    }

    return errors;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitError(null);

    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setIsSaving(true);
    try {
      const response = await apiRequest<RecordPaymentResult>('/payments', {
        method: 'POST',
        body: {
          invoiceId: invoice.id,
          amount: parseAmountInput(amount)!,
          method,
          date,
          note: note.trim(),
        },
        token,
      });
      onRecorded(response.data, response.message);
    } catch (error) {
      if (error instanceof ApiError) {
        setFieldErrors(error.fieldErrors());
        if (error.details.length === 0) setSubmitError(error.message);
      } else {
        setSubmitError('The payment could not be recorded. Please try again.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Record a payment for ${invoice.invoiceNumber}`}
      description={`${invoice.customerName} · ${formatMoney(invoice.balanceDue)} outstanding`}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" className="w-auto" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="payment-form" className="w-auto" isLoading={isSaving}>
            Record payment
          </Button>
        </div>
      }
    >
      <form id="payment-form" onSubmit={handleSubmit} className="space-y-5" noValidate>
        {submitError ? <Alert tone="error">{submitError}</Alert> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="payment-amount"
            label="Amount received (USD)"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            max={invoice.balanceDue.toFixed(2)}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            error={fieldErrors.amount}
            hint="Paying less than the balance keeps the invoice confirmed."
            required
          />
          <SelectField
            id="payment-method"
            label="Method"
            value={method}
            onChange={(event) => setMethod(event.target.value as PaymentMethod)}
            error={fieldErrors.method}
            required
          >
            {PAYMENT_METHODS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SelectField>
        </div>

        <TextField
          id="payment-date"
          label="Payment date"
          type="date"
          max={todayIso()}
          min={invoice.issueDate}
          value={date}
          onChange={(event) => setDate(event.target.value)}
          error={fieldErrors.date}
          required
        />

        <div>
          <label htmlFor="payment-note" className="field-label">
            Reference note
          </label>
          <textarea
            id="payment-note"
            className={
              fieldErrors.note ? 'field-input field-input-invalid min-h-[72px]' : 'field-input min-h-[72px]'
            }
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="TXN-4471 or receipt number"
            maxLength={2000}
            aria-invalid={fieldErrors.note ? true : undefined}
            aria-describedby="payment-note-hint"
          />
          {fieldErrors.note ? (
            <p className="mt-1.5 text-xs font-medium text-rose-600">{fieldErrors.note}</p>
          ) : (
            <p id="payment-note-hint" className="mt-1.5 text-xs text-slate-500">
              {PAYMENT_METHOD_HINT[method]}
            </p>
          )}
        </div>
      </form>
    </Modal>
  );
}
