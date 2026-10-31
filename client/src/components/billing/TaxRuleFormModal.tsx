import { useEffect, useState } from 'react';
import { ApiError, apiRequest } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { parseAmountInput } from '../../lib/format';
import type { TaxRule } from '../../lib/types';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Switch } from '../ui/Switch';
import { TextField } from '../ui/TextField';

interface TaxRuleFormModalProps {
  open: boolean;
  rule: TaxRule | null;
  onClose: () => void;
  onSaved: (rule: TaxRule) => void;
}

export function TaxRuleFormModal({ open, rule, onClose, onSaved }: TaxRuleFormModalProps) {
  const { token } = useAuth();
  const isEditing = rule !== null;

  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [isDefault, setIsDefault] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setName(rule?.name ?? '');
    setRate(rule ? String(rule.rate) : '');
    setIsActive(rule?.isActive ?? true);
    setIsDefault(rule?.isDefault ?? false);
    setFieldErrors({});
    setSubmitError(null);
  }, [open, rule]);

  const validate = (): Record<string, string> => {
    const errors: Record<string, string> = {};

    if (name.trim().length < 2) errors.name = 'Tax rule name must be at least 2 characters.';

    const parsedRate = parseAmountInput(rate);
    if (parsedRate === null) errors.rate = 'Enter a rate, for example 18.';
    else if (parsedRate < 0) errors.rate = 'A tax rate cannot be negative.';
    else if (parsedRate > 100) errors.rate = 'A tax rate cannot exceed 100%.';
    else if (Math.abs(parsedRate * 100 - Math.round(parsedRate * 100)) > 1e-6) {
      errors.rate = 'Use at most 2 decimal places.';
    }

    if (isDefault && !isActive) {
      errors.isDefault = 'Activate the rule before making it the default.';
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
        rate: parseAmountInput(rate)!,
        isActive,
        isDefault,
      };

      const result = isEditing
        ? await apiRequest<TaxRule>(`/tax-rules/${rule.id}`, { method: 'PATCH', body, token })
        : await apiRequest<TaxRule>('/tax-rules', { method: 'POST', body, token });

      onSaved(result.data);
    } catch (error) {
      if (error instanceof ApiError) {
        setFieldErrors(error.fieldErrors());
        if (error.details.length === 0) setSubmitError(error.message);
      } else {
        setSubmitError('Could not save the tax rule. Please try again.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEditing ? 'Edit tax rule' : 'New tax rule'}
      description="The default rate is applied to every contract that has no rate of its own. The rate is copied onto each invoice line when an invoice is issued."
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" className="w-auto" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="tax-rule-form" className="w-auto" isLoading={isSaving}>
            {isEditing ? 'Save changes' : 'Create tax rule'}
          </Button>
        </div>
      }
    >
      <form id="tax-rule-form" onSubmit={handleSubmit} className="space-y-5" noValidate>
        {submitError ? <Alert tone="error">{submitError}</Alert> : null}

        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <TextField
            id="tax-name"
            label="Rule name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={fieldErrors.name}
            placeholder="GST 18%"
            maxLength={100}
            required
          />
          <TextField
            id="tax-rate"
            label="Rate (%)"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            max="100"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
            error={fieldErrors.rate}
            placeholder="18.00"
            required
          />
        </div>

        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-ink">Active</p>
              <p className="text-xs text-slate-500">
                Inactive rates are never applied to a new invoice, but invoices already issued keep
                their snapshot of this rate.
              </p>
            </div>
            <Switch
              label="Active"
              checked={isActive}
              onChange={(next) => {
                setIsActive(next);
                if (!next) setIsDefault(false);
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-ink">Default rate</p>
              <p className="text-xs text-slate-500">
                Only one rule can be the default. Setting this clears the flag from the previous
                default.
              </p>
              {fieldErrors.isDefault ? (
                <p className="mt-1 text-xs font-medium text-rose-600">{fieldErrors.isDefault}</p>
              ) : null}
            </div>
            <Switch
              label="Default rate"
              checked={isDefault}
              disabled={!isActive}
              onChange={setIsDefault}
            />
          </div>
        </div>
      </form>
    </Modal>
  );
}
