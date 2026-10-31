import { useEffect, useMemo, useState } from 'react';
import { ApiError, apiRequest } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { formatMoney, parseAmountInput } from '../../lib/format';
import type { Product, ProductVariant } from '../../lib/types';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { TextField } from '../ui/TextField';

interface VariantFormModalProps {
  open: boolean;
  onClose: () => void;
  product: Product | null;
  onSaved: (productId: number, variant: ProductVariant) => void;
}

interface CreatedVariantResponse {
  productId: number;
  variant: ProductVariant;
}

/**
 * Adds an attribute variant to a product. The preview shows the arithmetic the
 * billing engine will use: effective price = product sales price + price_extra.
 * That is the "+560 for the Odoo brand" rule, made visible before saving.
 */
export function VariantFormModal({ open, onClose, product, onSaved }: VariantFormModalProps) {
  const { token } = useAuth();

  const [attributeName, setAttributeName] = useState('Brand');
  const [attributeValue, setAttributeValue] = useState('');
  const [priceExtra, setPriceExtra] = useState('0');
  const [sku, setSku] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAttributeName('Brand');
    setAttributeValue('');
    setPriceExtra('0');
    setSku('');
    setFieldErrors({});
    setSubmitError(null);
  }, [open, product]);

  const extraAmount = parseAmountInput(priceExtra);
  const effectivePrice = useMemo(
    () => (product ? product.salesPrice + (extraAmount ?? 0) : 0),
    [product, extraAmount],
  );

  const validate = (): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (attributeName.trim() === '') errors.attributeName = 'Name the attribute, for example Brand.';
    if (attributeValue.trim() === '') errors.attributeValue = 'Enter a value, for example Odoo.';

    if (priceExtra.trim() === '' || extraAmount === null) {
      errors.priceExtra = 'Enter a price extra (use 0 for no surcharge).';
    } else if (extraAmount < 0) {
      errors.priceExtra = 'Price extra cannot be negative.';
    }

    return errors;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!product) return;

    setSubmitError(null);
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setIsSaving(true);
    try {
      const result = await apiRequest<CreatedVariantResponse>(
        `/products/${product.id}/variants`,
        {
          method: 'POST',
          body: {
            attributeName: attributeName.trim(),
            attributeValue: attributeValue.trim(),
            priceExtra: extraAmount!,
            ...(sku.trim() === '' ? {} : { sku: sku.trim() }),
          },
          token,
        },
      );
      onSaved(result.data.productId, result.data.variant);
    } catch (error) {
      if (error instanceof ApiError) {
        setFieldErrors(error.fieldErrors());
        if (error.details.length === 0) setSubmitError(error.message);
      } else {
        setSubmitError('Could not add the variant. Please try again.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const previewLabel =
    attributeName.trim() !== '' && attributeValue.trim() !== ''
      ? `${attributeName.trim()}: ${attributeValue.trim()}`
      : 'New variant';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a variant"
      description={
        product
          ? `Variants adjust the price of ${product.name} without duplicating the product.`
          : undefined
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" className="w-auto" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="variant-form" className="w-auto" isLoading={isSaving}>
            Add variant
          </Button>
        </div>
      }
    >
      <form id="variant-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
        {submitError ? <Alert tone="error">{submitError}</Alert> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="variant-attribute"
            label="Attribute"
            value={attributeName}
            onChange={(event) => setAttributeName(event.target.value)}
            error={fieldErrors.attributeName}
            placeholder="Brand"
            maxLength={100}
            required
          />
          <TextField
            id="variant-value"
            label="Value"
            value={attributeValue}
            onChange={(event) => setAttributeValue(event.target.value)}
            error={fieldErrors.attributeValue}
            placeholder="Odoo"
            maxLength={100}
            required
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="variant-price-extra"
            label="Price extra"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={priceExtra}
            onChange={(event) => setPriceExtra(event.target.value)}
            error={fieldErrors.priceExtra}
            hint="Added to the product's sales price on every quotation line."
            required
          />
          <TextField
            id="variant-sku"
            label="SKU"
            value={sku}
            onChange={(event) => setSku(event.target.value)}
            error={fieldErrors.sku}
            placeholder="BL-ERP-ODOO"
            maxLength={100}
          />
        </div>

        {product ? (
          <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-4">
            <p className="text-xs font-medium text-teal-900">Effective line price</p>
            <dl className="mt-2 space-y-1 text-sm tabular-nums">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-teal-900/80">{product.name}</dt>
                <dd className="font-medium text-teal-900">{formatMoney(product.salesPrice)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-teal-900/80">{previewLabel}</dt>
                <dd className="font-medium text-teal-900">
                  {extraAmount !== null && extraAmount > 0 ? '+' : ''}
                  {formatMoney(extraAmount ?? 0)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 border-t border-teal-200 pt-1.5">
                <dt className="font-semibold text-teal-950">Effective price</dt>
                <dd className="text-lg font-semibold text-teal-950">
                  {formatMoney(effectivePrice)}
                </dd>
              </div>
            </dl>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
