import { AlertCircle, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiRequest } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { cx } from '../../lib/cx';
import {
  formatMoney,
  intervalLabel,
  parseAmountInput,
  todayIso,
} from '../../lib/format';
import { PAYMENT_TERM_OPTIONS } from '../../lib/subscription-status';
import type {
  PaymentTerms,
  Plan,
  Product,
  QuotationTemplate,
  Subscription,
  User,
} from '../../lib/types';
import { useApiResource } from '../../lib/use-api-resource';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Modal } from '../ui/Modal';
import { SelectField } from '../ui/SelectField';
import { TextAreaField } from '../ui/TextAreaField';
import { TextField } from '../ui/TextField';

type Mode = 'template' | 'manual';

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

function listPrice(product: Product | undefined, variantId: string): number {
  if (!product) return 0;
  const variant = product.variants.find((candidate) => candidate.id === Number(variantId));
  return product.salesPrice + (variant?.priceExtra ?? 0);
}

interface NewSubscriptionModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (subscription: Subscription) => void;
}

/**
 * Two ways to start a contract, both ending in the same Draft state:
 *   - from a quotation template, where the server copies the plan and lines;
 *   - manually, with an explicit plan and hand-built lines.
 * The mode is a real choice, not a hidden default, because the API refuses a
 * body that carries both.
 */
export function NewSubscriptionModal({ open, onClose, onSaved }: NewSubscriptionModalProps) {
  const { token } = useAuth();
  const { data: users } = useApiResource<User[]>('/admin/users');
  const { data: templates } = useApiResource<QuotationTemplate[]>('/quotation-templates');
  const { data: plans } = useApiResource<Plan[]>('/plans');
  const { data: products } = useApiResource<Product[]>('/products');

  const nextKey = useRef(0);
  const makeKey = () => {
    nextKey.current += 1;
    return `line-${nextKey.current}`;
  };

  const [mode, setMode] = useState<Mode>('template');
  const [customerId, setCustomerId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [planId, setPlanId] = useState('');
  const [startDate, setStartDate] = useState(todayIso());
  const [expiryDate, setExpiryDate] = useState('');
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerms>('Immediate Payment');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([emptyLine('line-0')]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    nextKey.current = 1;
    setMode('template');
    setCustomerId('');
    setTemplateId('');
    setPlanId('');
    setStartDate(todayIso());
    setExpiryDate('');
    setPaymentTerms('Immediate Payment');
    setNotes('');
    setLines([emptyLine('line-1')]);
    setFieldErrors({});
    setLineErrors({});
    setSubmitError(null);
  }, [open]);

  const customers = useMemo(
    () => (users ?? []).filter((user) => user.role === 'CUSTOMER' && user.isActive),
    [users],
  );
  const activePlans = useMemo(() => (plans ?? []).filter((plan) => plan.isActive), [plans]);
  const activeProducts = useMemo(
    () => (products ?? []).filter((product) => product.isActive),
    [products],
  );

  const selectedTemplate = (templates ?? []).find(
    (template) => template.id === Number(templateId),
  );
  const selectedPlan = activePlans.find((plan) => plan.id === Number(planId));

  const manualTotal = useMemo(
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

  const changeProduct = (key: string, productId: string) => {
    const product = activeProducts.find((candidate) => candidate.id === Number(productId));
    updateLine(key, {
      productId,
      variantId: '',
      unitPrice: product ? product.salesPrice.toFixed(2) : '',
    });
  };

  const changeVariant = (key: string, variantId: string) => {
    const line = lines.find((candidate) => candidate.key === key);
    const product = activeProducts.find((candidate) => candidate.id === Number(line?.productId));
    updateLine(key, {
      variantId,
      unitPrice: product ? listPrice(product, variantId).toFixed(2) : line?.unitPrice ?? '',
    });
  };

  const validate = (): boolean => {
    const nextFieldErrors: Record<string, string> = {};
    const nextLineErrors: Record<string, string> = {};

    if (customerId === '') nextFieldErrors.customerId = 'Choose the customer this contract is for.';
    if (startDate === '') nextFieldErrors.startDate = 'Choose a start date.';
    if (expiryDate !== '' && expiryDate < startDate) {
      nextFieldErrors.expiryDate = 'The expiry date must be on or after the start date.';
    }

    if (mode === 'template') {
      if (templateId === '') nextFieldErrors.templateId = 'Choose a quotation template.';
    } else {
      if (planId === '') nextFieldErrors.planId = 'Choose the plan this contract bills on.';

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
    }

    setFieldErrors(nextFieldErrors);
    setLineErrors(nextLineErrors);
    return Object.keys(nextFieldErrors).length === 0 && Object.keys(nextLineErrors).length === 0;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitError(null);
    if (!validate()) return;

    setIsSaving(true);
    try {
      const common = {
        customerId: Number(customerId),
        startDate,
        ...(expiryDate === '' ? {} : { expiryDate }),
        paymentTerms,
        ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
      };

      const body =
        mode === 'template'
          ? { ...common, templateId: Number(templateId) }
          : {
              ...common,
              planId: Number(planId),
              lines: lines.map((line) => ({
                productId: Number(line.productId),
                ...(line.variantId === '' ? {} : { variantId: Number(line.variantId) }),
                quantity: Number(line.quantity),
                ...(line.unitPrice.trim() === ''
                  ? {}
                  : { unitPrice: parseAmountInput(line.unitPrice)! }),
              })),
            };

      const result = await apiRequest<Subscription>('/subscriptions', {
        method: 'POST',
        body,
        token,
      });
      onSaved(result.data);
    } catch (error) {
      if (error instanceof ApiError) {
        const errors = error.fieldErrors();
        const { lines: lineMessage, ...rest } = errors;
        setFieldErrors(rest);
        if (lineMessage) setSubmitError(lineMessage);
        else setSubmitError(error.message);
      } else {
        setSubmitError('Could not create the subscription. Please try again.');
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
      title="New subscription"
      description="A contract starts as a Draft. Move it through quotation, confirmation and activation from the subscription board."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">
            Contract value{' '}
            <span className="ml-1 text-base font-semibold tabular-nums text-ink">
              {formatMoney(mode === 'template' ? selectedTemplate?.totalValue ?? 0 : manualTotal)}
            </span>
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" className="w-auto" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="subscription-form" className="w-auto" isLoading={isSaving}>
              Create subscription
            </Button>
          </div>
        </div>
      }
    >
      <form id="subscription-form" onSubmit={handleSubmit} className="space-y-5" noValidate>
        {submitError ? <Alert tone="error">{submitError}</Alert> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            id="subscription-customer"
            label="Customer"
            value={customerId}
            onChange={(event) => setCustomerId(event.target.value)}
            error={fieldErrors.customerId}
            required
          >
            <option value="">Select a customer</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name} — {customer.email}
              </option>
            ))}
          </SelectField>

          <SelectField
            id="subscription-payment-terms"
            label="Payment terms"
            value={paymentTerms}
            onChange={(event) => setPaymentTerms(event.target.value as PaymentTerms)}
          >
            {PAYMENT_TERM_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SelectField>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="subscription-start"
            label="Start date"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            error={fieldErrors.startDate}
            required
          />
          <TextField
            id="subscription-expiry"
            label="Expiry date"
            type="date"
            value={expiryDate}
            onChange={(event) => setExpiryDate(event.target.value)}
            hint="Leave blank for an open-ended contract."
            error={fieldErrors.expiryDate}
          />
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-ink">How should this contract start?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                { value: 'template', title: 'From a template', detail: 'Copies the plan and lines of a saved offer.' },
                { value: 'manual', title: 'Build it by hand', detail: 'Pick a plan and add product lines yourself.' },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setMode(option.value)}
                aria-pressed={mode === option.value}
                className={cx(
                  'rounded-xl border px-4 py-3 text-left transition-colors',
                  mode === option.value
                    ? 'border-plum-400 bg-plum-50/70 ring-1 ring-inset ring-plum-200'
                    : 'border-slate-200 bg-white hover:border-slate-300',
                )}
              >
                <span className="block text-sm font-semibold text-ink">{option.title}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-slate-600">
                  {option.detail}
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        {mode === 'template' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              id="subscription-template"
              label="Quotation template"
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
              error={fieldErrors.templateId}
              required
            >
              <option value="">Select a template</option>
              {(templates ?? []).map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} — {formatMoney(template.totalValue)}
                </option>
              ))}
            </SelectField>

            <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-sm">
              {selectedTemplate ? (
                <>
                  <p className="font-medium text-ink">{selectedTemplate.planName}</p>
                  <p className="mt-0.5 text-xs text-slate-600">
                    {intervalLabel(selectedTemplate.planBillingInterval)} billing ·{' '}
                    {selectedTemplate.lineCount}{' '}
                    {selectedTemplate.lineCount === 1 ? 'line' : 'lines'} · valid{' '}
                    {selectedTemplate.validityDays} days
                  </p>
                </>
              ) : (
                <p className="text-xs text-slate-500">
                  Choose a template to see the plan and lines it will copy.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <SelectField
              id="subscription-plan"
              label="Plan"
              value={planId}
              onChange={(event) => setPlanId(event.target.value)}
              error={fieldErrors.planId}
              required
            >
              <option value="">Select a plan</option>
              {activePlans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name} — {formatMoney(plan.price)} / {intervalLabel(plan.billingInterval)}
                </option>
              ))}
            </SelectField>

            {selectedPlan ? (
              <p className="text-xs text-slate-500">
                Minimum {selectedPlan.minQuantity}{' '}
                {selectedPlan.minQuantity === 1 ? 'base unit' : 'base units'} on this plan.
                Add-on lines do not count towards it.
              </p>
            ) : null}

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-ink">Product lines</h3>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-auto px-3 py-2 text-xs"
                  onClick={() => setLines((current) => [...current, emptyLine(makeKey())])}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Add line
                </Button>
              </div>

              {lines.map((line, index) => {
                const product = activeProducts.find(
                  (candidate) => candidate.id === Number(line.productId),
                );
                const message = lineErrors[line.key];

                return (
                  <div
                    key={line.key}
                    className={cx(
                      'rounded-xl border p-3',
                      message ? 'border-rose-200 bg-rose-50/40' : 'border-slate-200',
                    )}
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
                          onClick={() =>
                            setLines((current) =>
                              current.length === 1
                                ? current
                                : current.filter((candidate) => candidate.key !== line.key),
                            )
                          }
                          disabled={lines.length === 1}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </IconButton>
                      </div>
                    </div>

                    {message ? (
                      <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-rose-700">
                        <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                        {message}
                      </p>
                    ) : product ? (
                      <p className="mt-2 text-xs text-slate-500">
                        List price {formatMoney(listPrice(product, line.variantId))}
                        {product.type === 'Add-on'
                          ? ' — add-ons can be switched off later in the portal.'
                          : '.'}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <TextAreaField
          id="subscription-notes"
          label="Notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          error={fieldErrors.notes}
          placeholder="Anything the billing team should know about this contract."
          maxLength={2000}
        />
      </form>
    </Modal>
  );
}
