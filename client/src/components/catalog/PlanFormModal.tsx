import { useEffect, useState } from 'react';
import { ApiError, apiRequest } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { parseAmountInput } from '../../lib/format';
import { PLAN_FLAGS, type PlanFlagKey } from '../../lib/plan-flags';
import type { BillingInterval, Plan } from '../../lib/types';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { SelectField } from '../ui/SelectField';
import { Switch } from '../ui/Switch';
import { TextField } from '../ui/TextField';

const INTERVALS: BillingInterval[] = ['daily', 'weekly', 'monthly', 'yearly'];

const DEFAULT_FLAGS: Record<PlanFlagKey, boolean> = {
  autoClose: false,
  allowEarlyClose: true,
  allowPause: true,
  allowRenew: true,
};

/** Today in the user's own timezone, as the 'YYYY-MM-DD' a date input expects. */
function todayIsoDate(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

interface PlanFormModalProps {
  open: boolean;
  onClose: () => void;
  plan: Plan | null;
  onSaved: (plan: Plan) => void;
}

export function PlanFormModal({ open, onClose, plan, onSaved }: PlanFormModalProps) {
  const { token } = useAuth();
  const isEditing = plan !== null;

  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [billingInterval, setBillingInterval] = useState<BillingInterval>('monthly');
  const [minQuantity, setMinQuantity] = useState('1');
  const [availableFrom, setAvailableFrom] = useState(todayIsoDate());
  const [availableTo, setAvailableTo] = useState('');
  const [flags, setFlags] = useState<Record<PlanFlagKey, boolean>>(DEFAULT_FLAGS);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setName(plan?.name ?? '');
    setPrice(plan ? String(plan.price) : '');
    setBillingInterval(plan?.billingInterval ?? 'monthly');
    setMinQuantity(plan ? String(plan.minQuantity) : '1');
    setAvailableFrom(plan?.availableFrom ?? todayIsoDate());
    setAvailableTo(plan?.availableTo ?? '');
    setFlags(
      plan
        ? {
            autoClose: plan.autoClose,
            allowEarlyClose: plan.allowEarlyClose,
            allowPause: plan.allowPause,
            allowRenew: plan.allowRenew,
          }
        : DEFAULT_FLAGS,
    );
    setFieldErrors({});
    setSubmitError(null);
  }, [open, plan]);

  const validate = (): Record<string, string> => {
    const errors: Record<string, string> = {};

    if (name.trim().length < 2) errors.name = 'Plan name must be at least 2 characters.';

    const parsedPrice = parseAmountInput(price);
    if (parsedPrice === null) errors.price = 'Enter a plan price, for example 1200.';
    else if (parsedPrice < 0) errors.price = 'Plan price cannot be negative.';

    const quantity = Number(minQuantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      errors.minQuantity = 'Minimum quantity must be a whole number of at least 1.';
    }

    if (availableFrom === '') errors.availableFrom = 'Choose the date this plan becomes available.';
    if (availableTo !== '' && availableFrom !== '' && availableTo < availableFrom) {
      errors.availableTo = 'Available-to date must be on or after the available-from date.';
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
      const body = {
        name: name.trim(),
        price: parseAmountInput(price)!,
        billingInterval,
        minQuantity: Number(minQuantity),
        availableFrom,
        availableTo: availableTo === '' ? null : availableTo,
        ...flags,
      };

      const result = isEditing
        ? await apiRequest<Plan>(`/plans/${plan.id}`, { method: 'PATCH', body, token })
        : await apiRequest<Plan>('/plans', { method: 'POST', body, token });

      onSaved(result.data);
    } catch (error) {
      if (error instanceof ApiError) {
        setFieldErrors(error.fieldErrors());
        if (error.details.length === 0) setSubmitError(error.message);
      } else {
        setSubmitError('Could not save the plan. Please try again.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={isEditing ? 'Edit plan' : 'New subscription plan'}
      description="Billing interval, minimum quantity and lifecycle flags define what a subscriber may do."
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" className="w-auto" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="plan-form" className="w-auto" isLoading={isSaving}>
            {isEditing ? 'Save changes' : 'Create plan'}
          </Button>
        </div>
      }
    >
      <form id="plan-form" onSubmit={handleSubmit} className="space-y-5" noValidate>
        {submitError ? <Alert tone="error">{submitError}</Alert> : null}

        <TextField
          id="plan-name"
          label="Plan name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={fieldErrors.name}
          placeholder="Monthly Pro"
          maxLength={255}
          required
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="plan-price"
            label="Price per interval"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            error={fieldErrors.price}
            placeholder="1200.00"
            required
          />

          <SelectField
            id="plan-interval"
            label="Billing interval"
            value={billingInterval}
            onChange={(event) => setBillingInterval(event.target.value as BillingInterval)}
            error={fieldErrors.billingInterval}
            required
          >
            {INTERVALS.map((option) => (
              <option key={option} value={option}>
                {option.charAt(0).toUpperCase() + option.slice(1)}
              </option>
            ))}
          </SelectField>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            id="plan-min-quantity"
            label="Minimum quantity"
            type="number"
            inputMode="numeric"
            step="1"
            min="1"
            value={minQuantity}
            onChange={(event) => setMinQuantity(event.target.value)}
            error={fieldErrors.minQuantity}
            required
          />

          <TextField
            id="plan-available-from"
            label="Available from"
            type="date"
            value={availableFrom}
            onChange={(event) => setAvailableFrom(event.target.value)}
            error={fieldErrors.availableFrom}
            required
          />

          <TextField
            id="plan-available-to"
            label="Available to"
            type="date"
            value={availableTo}
            onChange={(event) => setAvailableTo(event.target.value)}
            error={fieldErrors.availableTo}
            hint="Leave blank for no end date."
          />
        </div>

        <fieldset className="rounded-xl border border-slate-200">
          <legend className="px-2 text-sm font-semibold text-ink">Lifecycle</legend>
          <div className="divide-y divide-slate-100">
            {PLAN_FLAGS.map((flag) => (
              <div key={flag.key} className="flex items-center justify-between gap-4 px-4 py-3">
                <div>
                  <p id={`plan-flag-${flag.key}-label`} className="text-sm font-medium text-ink">
                    {flag.label}
                  </p>
                  <p className="text-xs text-slate-500">{flag.description}</p>
                </div>
                <Switch
                  label={flag.label}
                  checked={flags[flag.key]}
                  onChange={(next) => setFlags((current) => ({ ...current, [flag.key]: next }))}
                />
              </div>
            ))}
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
