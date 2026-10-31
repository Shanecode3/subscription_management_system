import { AlertCircle, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiRequest } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { formatMoney, intervalLabel, parseAmountInput } from '../../lib/format';
import type { Plan, Product, QuotationTemplate } from '../../lib/types';
import { useApiResource } from '../../lib/use-api-resource';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Modal } from '../ui/Modal';
import { SelectField } from '../ui/SelectField';
import { TextAreaField } from '../ui/TextAreaField';
import { TextField } from '../ui/TextField';

interface DraftLine {
  key: string;
  productId: string;
  variantId: string;
  quantity: string;
  unitPrice: string;
}

function emptyLine(key: string): DraftLine {
  return { key, productId: '', variantId: '', quantity: '1', unitPrice: '' };
}

function resolveListPrice(product: Product | undefined, variantId: string) {
  if (!product) return { price: 0, extra: 0 };
  const variant = product.variants.find((candidate) => candidate.id === Number(variantId));
  const extra = variant?.priceExtra ?? 0;
  return { price: product.salesPrice + extra, extra };
}

interface TemplateFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (template: QuotationTemplate) => void;
}

/**
 * Builds a quotation template: header (plan, validity) plus itemised lines.
 * Choosing a product or variant fills the unit price with the same rule the
 * server applies (base price + variant surcharge), so the Odoo brand preview
 * reads $1,760.00 for a $1,200 product before the template is saved.
 */
export function TemplateFormModal({ open, onClose, onSaved }: TemplateFormModalProps) {
  const { token } = useAuth();
  const { data: products } = useApiResource<Product[]>('/products');
  const { data: plans } = useApiResource<Plan[]>('/plans');

  const nextKey = useRef(0);
  const makeKey = () => {
    nextKey.current += 1;
    return `line-${nextKey.current}`;
  };

  const [name, setName] = useState('');
  const [planId, setPlanId] = useState('');
  const [validityDays, setValidityDays] = useState('30');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([emptyLine('line-0')]);
  const [headerErrors, setHeaderErrors] = useState<Record<string, string>>({});
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    nextKey.current = 1;
    setName('');
    setPlanId('');
    setValidityDays('30');
    setNotes('');
    setLines([emptyLine('line-1')]);
    setHeaderErrors({});
    setLineErrors({});
    setSubmitError(null);
  }, [open]);

  const activePlans = useMemo(() => (plans ?? []).filter((plan) => plan.isActive), [plans]);
  const activeProducts = useMemo(
    () => (products ?? []).filter((product) => product.isActive),
    [products],
  );

  const totalValue = useMemo(
    () =>
      lines.reduce((sum, line) => {
        const quantity = Number.parseInt(line.quantity, 10);
        const price = parseAmountInput(line.unitPrice) ?? 0;
        if (!Number.isFinite(quantity) || quantity < 1) return sum;
        return sum + quantity * price;
      }, 0),
    [lines],
  );

  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  };

  const changeProduct = (key: string, nextProductId: string) => {
    const product = activeProducts.find((candidate) => candidate.id === Number(nextProductId));
    updateLine(key, {
      productId: nextProductId,
      variantId: '',
      unitPrice: product ? product.salesPrice.toFixed(2) : '',
    });
  };

  const changeVariant = (key: string, nextVariantId: string) => {
    const line = lines.find((candidate) => candidate.key === key);
    const product = activeProducts.find((candidate) => candidate.id === Number(line?.productId));
    const { price } = resolveListPrice(product, nextVariantId);
    updateLine(key, {
      variantId: nextVariantId,
      unitPrice: product ? price.toFixed(2) : line?.unitPrice ?? '',
    });
  };

  const addLine = () => setLines((current) => [...current, emptyLine(makeKey())]);

  const removeLine = (key: string) =>
    setLines((current) =>
      current.length === 1 ? current : current.filter((line) => line.key !== key),
    );

  const validate = () => {
    const nextHeaderErrors: Record<string, string> = {};
    const nextLineErrors: Record<string, string> = {};

    if (name.trim().length < 2) nextHeaderErrors.name = 'Template name must be at least 2 characters.';
    if (planId === '') nextHeaderErrors.planId = 'Choose the plan this template starts from.';

    const validity = Number(validityDays);
    if (!Number.isInteger(validity) || validity < 1) {
      nextHeaderErrors.validityDays = 'Validity must be a whole number of days, at least 1.';
    } else if (validity > 3650) {
      nextHeaderErrors.validityDays = 'Validity must be 3,650 days or fewer.';
    }

    const seen = new Set<string>();
    for (const line of lines) {
      if (line.productId === '') {
        nextLineErrors[line.key] = 'Choose a product for this line.';
        continue;
      }

      const quantity = Number(line.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) {
        nextLineErrors[line.key] = 'Quantity must be a whole number of at least 1.';
        continue;
      }

      if (line.unitPrice.trim() !== '') {
        const price = parseAmountInput(line.unitPrice);
        if (price === null || price < 0) {
          nextLineErrors[line.key] = 'Unit price must be a number of 0 or more.';
          continue;
        }
      }

      const duplicateKey = `${line.productId}:${line.variantId === '' ? 'none' : line.variantId}`;
      if (seen.has(duplicateKey)) {
        nextLineErrors[line.key] =
          'This product and variant is already listed — combine the quantities.';
        continue;
      }
      seen.add(duplicateKey);
    }

    setHeaderErrors(nextHeaderErrors);
    setLineErrors(nextLineErrors);
    return Object.keys(nextHeaderErrors).length === 0 && Object.keys(nextLineErrors).length === 0;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitError(null);
    if (!validate()) return;

    setIsSaving(true);
    try {
      const body = {
        name: name.trim(),
        planId: Number(planId),
        validityDays: Number(validityDays),
        ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
        lines: lines.map((line) => ({
          productId: Number(line.productId),
          ...(line.variantId === '' ? {} : { variantId: Number(line.variantId) }),
          quantity: Number(line.quantity),
          ...(line.unitPrice.trim() === ''
            ? {}
            : { unitPrice: parseAmountInput(line.unitPrice)! }),
        })),
      };

      const result = await apiRequest<QuotationTemplate>('/quotation-templates', {
        method: 'POST',
        body,
        token,
      });
      onSaved(result.data);
    } catch (error) {
      if (error instanceof ApiError) {
        const fieldErrors = error.fieldErrors();
        // Server-side line problems are reported against `lines`; surface them
        // once above the lines instead of pinning them to an arbitrary row.
        const { lines: lineMessage, ...rest } = fieldErrors;
        setHeaderErrors(rest);
        if (lineMessage) setSubmitError(lineMessage);
        else if (error.details.length === 0) setSubmitError(error.message);
        else setSubmitError(error.message);
      } else {
        setSubmitError('Could not save the template. Please try again.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="New quotation template"
      description="A template pre-fills a subscription: its plan, its validity window and its product lines."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">
            Template value{' '}
            <span className="ml-1 text-base font-semibold tabular-nums text-ink">
              {formatMoney(totalValue)}
            </span>
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" className="w-auto" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="template-form" className="w-auto" isLoading={isSaving}>
              Create template
            </Button>
          </div>
        </div>
      }
    >
      <form id="template-form" onSubmit={handleSubmit} className="space-y-5" noValidate>
        {submitError ? <Alert tone="error">{submitError}</Alert> : null}

        <TextField
          id="template-name"
          label="Template name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={headerErrors.name}
          placeholder="Enterprise Monthly Starter"
          maxLength={255}
          required
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            id="template-plan"
            label="Default plan"
            value={planId}
            onChange={(event) => setPlanId(event.target.value)}
            error={headerErrors.planId}
            required
          >
            <option value="">Select a plan</option>
            {activePlans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name} — {formatMoney(plan.price)} / {intervalLabel(plan.billingInterval)}
              </option>
            ))}
          </SelectField>

          <TextField
            id="template-validity"
            label="Validity (days)"
            type="number"
            inputMode="numeric"
            step="1"
            min="1"
            value={validityDays}
            onChange={(event) => setValidityDays(event.target.value)}
            error={headerErrors.validityDays}
            required
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">Product lines</h3>
            <Button
              type="button"
              variant="secondary"
              className="w-auto px-3 py-2 text-xs"
              onClick={addLine}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add line
            </Button>
          </div>

          {lines.map((line, index) => {
            const product = activeProducts.find(
              (candidate) => candidate.id === Number(line.productId),
            );
            const { price, extra } = resolveListPrice(product, line.variantId);
            const lineMessage = lineErrors[line.key];

            return (
              <div
                key={line.key}
                className={
                  lineMessage
                    ? 'rounded-xl border border-rose-200 bg-rose-50/40 p-3'
                    : 'rounded-xl border border-slate-200 p-3'
                }
              >
                <div className="grid gap-3 sm:grid-cols-12">
                  <div className="sm:col-span-4">
                    <SelectField
                      id={`${line.key}-product`}
                      label={`Product ${index + 1}`}
                      value={line.productId}
                      onChange={(event) => changeProduct(line.key, event.target.value)}
                    >
                      <option value="">Select a product</option>
                      {activeProducts.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name} — {formatMoney(option.salesPrice)}
                        </option>
                      ))}
                    </SelectField>
                  </div>

                  <div className="sm:col-span-3">
                    <SelectField
                      id={`${line.key}-variant`}
                      label="Variant"
                      value={line.variantId}
                      onChange={(event) => changeVariant(line.key, event.target.value)}
                      disabled={!product || product.variants.length === 0}
                    >
                      <option value="">
                        {product && product.variants.length > 0 ? 'No variant' : 'No variants'}
                      </option>
                      {(product?.variants ?? []).map((variant) => (
                        <option key={variant.id} value={variant.id}>
                          {variant.attributeName}: {variant.attributeValue} (+
                          {formatMoney(variant.priceExtra)})
                        </option>
                      ))}
                    </SelectField>
                  </div>

                  <div className="sm:col-span-2">
                    <TextField
                      id={`${line.key}-quantity`}
                      label="Qty"
                      type="number"
                      inputMode="numeric"
                      step="1"
                      min="1"
                      value={line.quantity}
                      onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <TextField
                      id={`${line.key}-unit-price`}
                      label="Unit price"
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={line.unitPrice}
                      onChange={(event) => updateLine(line.key, { unitPrice: event.target.value })}
                    />
                  </div>

                  <div className="flex items-end sm:col-span-1">
                    <IconButton
                      label={`Remove line ${index + 1}`}
                      tone="danger"
                      onClick={() => removeLine(line.key)}
                      disabled={lines.length === 1}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </IconButton>
                  </div>
                </div>

                {lineMessage ? (
                  <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-rose-700">
                    <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    {lineMessage}
                  </p>
                ) : product ? (
                  <p className="mt-2 text-xs text-slate-500">
                    List price {formatMoney(price)}
                    {extra > 0 ? ` — includes ${formatMoney(extra)} for the variant surcharge.` : '.'}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        <TextAreaField
          id="template-notes"
          label="Notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          error={headerErrors.notes}
          placeholder="Who this offer is for, and anything the sales rep should know."
          maxLength={2000}
        />
      </form>
    </Modal>
  );
}
