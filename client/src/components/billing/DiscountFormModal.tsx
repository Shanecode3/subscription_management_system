import { useEffect, useState } from 'react';
import { ApiError, apiRequest } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { parseAmountInput, todayIso } from '../../lib/format';
import type { DiscountRule, DiscountScope, DiscountType, Product } from '../../lib/types';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { SelectField } from '../ui/SelectField';
import { TextField } from '../ui/TextField';

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,49}$/;

interface DiscountFormModalProps {
  open: boolean;
  rule: DiscountRule | null;
  products: Product[];
  onClose: () => void;
  onSaved: (rule: DiscountRule) => void;
}

/**
 * The Admin authoring form. Every cross-field rule is checked here first (so the
 * message names the field) and again on the server (so the rule cannot be
 * bypassed by posting straight to the API).
 */
export function DiscountFormModal({ open, rule, products, onClose, onSaved }: DiscountFormModalProps) {
  const { token } = useAuth();
  const isEditing = rule !== null;

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState<DiscountType>('percentage');
  const [discountValue, setDiscountValue] = useState('');
  const [scope, setScope] = useState<DiscountScope>('whole_subscription');
  const [targetProductId, setTargetProductId] = useState('');
  const [minPurchaseAmount, setMinPurchaseAmount] = useState('0');
  const [minQuantity, setMinQuantity] = useState('0');
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState('');
  const [maxUses, setMaxUses] = useState('100');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setName(rule?.name ?? '');
    setCode(rule?.code ?? '');
    setDiscountType(rule?.discountType ?? 'percentage');
    setDiscountValue(rule ? String(rule.discountValue) : '');
    setScope(rule?.scope ?? 'whole_subscription');
    setTargetProductId(rule?.targetProductId ? String(rule.targetProductId) : '');
    setMinPurchaseAmount(rule ? String(rule.minPurchaseAmount) : '0');
    setMinQuantity(rule ? String(rule.minQuantity) : '0');
    setStartDate(rule?.startDate ?? todayIso());
    setEndDate(rule?.endDate ?? '');
    setMaxUses(rule ? String(rule.maxUses) : '100');
    setFieldErrors({});
    setSubmitError(null);
  }, [open, rule]);

  const validate = (): Record<string, string> => {
    const errors: Record<string, string> = {};

    if (name.trim().length < 3) errors.name = 'Discount name must be at least 3 characters.';

    const normalisedCode = code.trim().toUpperCase();
    if (!CODE_PATTERN.test(normalisedCode)) {
      errors.code = 'Use 3–50 letters, numbers, hyphens or underscores.';
    }

    const parsedValue = parseAmountInput(discountValue);
    if (parsedValue === null) errors.discountValue = 'Enter the discount amount or percentage.';
    else if (parsedValue <= 0) errors.discountValue = 'Discount value must be greater than zero.';
    else if (discountType === 'percentage' && parsedValue > 100) {
      errors.discountValue = 'A percentage discount cannot exceed 100%.';
    }

    if (scope === 'specific_product' && targetProductId === '') {
      errors.targetProductId = 'Choose the product this discount applies to.';
    }

    const parsedMinPurchase = parseAmountInput(minPurchaseAmount);
    if (parsedMinPurchase === null || parsedMinPurchase < 0) {
      errors.minPurchaseAmount = 'Minimum purchase must be zero or more.';
    }

    const parsedMinQuantity = Number(minQuantity);
    if (!Number.isInteger(parsedMinQuantity) || parsedMinQuantity < 0) {
      errors.minQuantity = 'Minimum quantity must be a whole number of zero or more.';
    }

    const parsedMaxUses = Number(maxUses);
    if (!Number.isInteger(parsedMaxUses) || parsedMaxUses < 1) {
      errors.maxUses = 'Maximum uses must be a whole number of at least 1.';
    } else if (rule && parsedMaxUses < rule.currentUses) {
      errors.maxUses = `This discount has already been used ${rule.currentUses} time(s).`;
    }

    if (startDate === '') errors.startDate = 'Choose the date this discount starts.';
    if (endDate === '') errors.endDate = 'Choose the date this discount ends.';
    if (startDate !== '' && endDate !== '' && endDate < startDate) {
      errors.endDate = 'End date must be on or after the start date.';
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
        code: code.trim().toUpperCase(),
        discountType,
        discountValue: parseAmountInput(discountValue)!,
        scope,
        targetProductId: scope === 'specific_product' ? Number(targetProductId) : null,
        minPurchaseAmount: parseAmountInput(minPurchaseAmount)!,
        minQuantity: Number(minQuantity),
        startDate,
        endDate,
        maxUses: Number(maxUses),
      };

      const result = isEditing
        ? await apiRequest<DiscountRule>(`/discount-rules/${rule.id}`, {
            method: 'PATCH',
            body,
            token,
          })
        : await apiRequest<DiscountRule>('/discount-rules', { method: 'POST', body, token });

      onSaved(result.data);
    } catch (error) {
      if (error instanceof ApiError) {
        setFieldErrors(error.fieldErrors());
        if (error.details.length === 0) setSubmitError(error.message);
      } else {
        setSubmitError('Could not save the discount. Please try again.');
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
      title={isEditing ? 'Edit discount' : 'New discount rule'}
      description="Admin-only. The billing engine applies the most valuable rule the contract qualifies for, then stops applying it at its end date or usage limit."
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" className="w-auto" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="discount-form" className="w-auto" isLoading={isSaving}>
            {isEditing ? 'Save changes' : 'Create discount'}
          </Button>
        </div>
      }
    >
      <form id="discount-form" onSubmit={handleSubmit} className="space-y-5" noValidate>
        {submitError ? <Alert tone="error">{submitError}</Alert> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="discount-name"
            label="Discount name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={fieldErrors.name}
            placeholder="Welcome offer — 10% off"
            maxLength={255}
            required
          />
          <TextField
            id="discount-code"
            label="Code"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            error={fieldErrors.code}
            hint="Shown on the invoice line so a customer can trace the discount."
            placeholder="WELCOME10"
            maxLength={50}
            required
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField
            id="discount-type"
            label="Type"
            value={discountType}
            onChange={(event) => setDiscountType(event.target.value as DiscountType)}
            error={fieldErrors.discountType}
            required
          >
            <option value="percentage">Percentage</option>
            <option value="fixed">Fixed amount</option>
          </SelectField>

          <TextField
            id="discount-value"
            label={discountType === 'percentage' ? 'Percentage off (%)' : 'Amount off (USD)'}
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            max={discountType === 'percentage' ? '100' : undefined}
            value={discountValue}
            onChange={(event) => setDiscountValue(event.target.value)}
            error={fieldErrors.discountValue}
            required
          />

          <SelectField
            id="discount-scope"
            label="Applies to"
            value={scope}
            onChange={(event) => {
              const next = event.target.value as DiscountScope;
              setScope(next);
              if (next === 'whole_subscription') setTargetProductId('');
            }}
            error={fieldErrors.scope}
            required
          >
            <option value="whole_subscription">Whole subscription</option>
            <option value="specific_product">One product only</option>
          </SelectField>
        </div>

        {scope === 'specific_product' ? (
          <SelectField
            id="discount-target"
            label="Target product"
            value={targetProductId}
            onChange={(event) => setTargetProductId(event.target.value)}
            error={fieldErrors.targetProductId}
            required
          >
            <option value="">Choose a product…</option>
            {products
              .filter((product) => product.isActive)
              .map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
          </SelectField>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            id="discount-min-purchase"
            label="Minimum purchase (USD)"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={minPurchaseAmount}
            onChange={(event) => setMinPurchaseAmount(event.target.value)}
            error={fieldErrors.minPurchaseAmount}
            hint="0 means no threshold."
          />
          <TextField
            id="discount-min-quantity"
            label="Minimum quantity"
            type="number"
            inputMode="numeric"
            step="1"
            min="0"
            value={minQuantity}
            onChange={(event) => setMinQuantity(event.target.value)}
            error={fieldErrors.minQuantity}
            hint="Total units across the invoice."
          />
          <TextField
            id="discount-max-uses"
            label="Maximum uses"
            type="number"
            inputMode="numeric"
            step="1"
            min="1"
            value={maxUses}
            onChange={(event) => setMaxUses(event.target.value)}
            error={fieldErrors.maxUses}
            hint="Stops applying once reached."
            required
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="discount-start"
            label="Start date"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            error={fieldErrors.startDate}
            required
          />
          <TextField
            id="discount-end"
            label="End date"
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            error={fieldErrors.endDate}
            required
          />
        </div>
      </form>
    </Modal>
  );
}
