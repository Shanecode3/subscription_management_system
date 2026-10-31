import { useEffect, useState } from 'react';
import { ApiError, apiRequest } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { parseAmountInput } from '../../lib/format';
import type { Product, ProductType } from '../../lib/types';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { SelectField } from '../ui/SelectField';
import { TextAreaField } from '../ui/TextAreaField';
import { TextField } from '../ui/TextField';

const PRODUCT_TYPES: ProductType[] = ['Software', 'Service', 'Add-on'];

interface ProductFormModalProps {
  open: boolean;
  onClose: () => void;
  /** null creates a product; a product edits it. */
  product: Product | null;
  onSaved: (product: Product) => void;
}

export function ProductFormModal({ open, onClose, product, onSaved }: ProductFormModalProps) {
  const { token } = useAuth();
  const isEditing = product !== null;

  const [name, setName] = useState('');
  const [type, setType] = useState<ProductType>('Software');
  const [salesPrice, setSalesPrice] = useState('');
  const [costPrice, setCostPrice] = useState('0');
  const [notes, setNotes] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Reset every time the dialog opens so an abandoned edit never leaks in.
  useEffect(() => {
    if (!open) return;
    setName(product?.name ?? '');
    setType(product?.type ?? 'Software');
    setSalesPrice(product ? String(product.salesPrice) : '');
    setCostPrice(product ? String(product.costPrice) : '0');
    setNotes(product?.notes ?? '');
    setFieldErrors({});
    setSubmitError(null);
  }, [open, product]);

  const validate = (): Record<string, string> => {
    const errors: Record<string, string> = {};

    if (name.trim().length < 2) {
      errors.name = 'Product name must be at least 2 characters.';
    }

    const sales = parseAmountInput(salesPrice);
    if (sales === null) errors.salesPrice = 'Enter a sales price, for example 1200.';
    else if (sales < 0) errors.salesPrice = 'Sales price cannot be negative.';

    const cost = parseAmountInput(costPrice);
    if (costPrice.trim() !== '' && cost === null) errors.costPrice = 'Cost price must be a number.';
    else if (cost !== null && cost < 0) errors.costPrice = 'Cost price cannot be negative.';

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
        type,
        salesPrice: parseAmountInput(salesPrice)!,
        costPrice: parseAmountInput(costPrice) ?? 0,
        notes: notes.trim() === '' ? '' : notes.trim(),
      };

      const result = isEditing
        ? await apiRequest<Product>(`/products/${product.id}`, {
            method: 'PATCH',
            body,
            token,
          })
        : await apiRequest<Product>('/products', { method: 'POST', body, token });

      onSaved(result.data);
    } catch (error) {
      if (error instanceof ApiError) {
        setFieldErrors(error.fieldErrors());
        if (error.details.length === 0) setSubmitError(error.message);
      } else {
        setSubmitError('Could not save the product. Please try again.');
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
      title={isEditing ? 'Edit product' : 'New product'}
      description={
        isEditing
          ? 'Changes apply to future quotations. Existing invoices keep their original prices.'
          : 'Products are the building blocks of every quotation line.'
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" className="w-auto" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="product-form"
            className="w-auto"
            isLoading={isSaving}
          >
            {isEditing ? 'Save changes' : 'Create product'}
          </Button>
        </div>
      }
    >
      <form id="product-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
        {submitError ? <Alert tone="error">{submitError}</Alert> : null}

        <TextField
          id="product-name"
          label="Product name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={fieldErrors.name}
          placeholder="Brightloop Enterprise ERP"
          maxLength={255}
          required
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField
            id="product-type"
            label="Type"
            value={type}
            onChange={(event) => setType(event.target.value as ProductType)}
            error={fieldErrors.type}
            required
          >
            {PRODUCT_TYPES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SelectField>

          <TextField
            id="product-sales-price"
            label="Sales price"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={salesPrice}
            onChange={(event) => setSalesPrice(event.target.value)}
            error={fieldErrors.salesPrice}
            placeholder="1200.00"
            required
          />

          <TextField
            id="product-cost-price"
            label="Cost price"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={costPrice}
            onChange={(event) => setCostPrice(event.target.value)}
            error={fieldErrors.costPrice}
            hint="Optional. Used for margin reporting."
          />
        </div>

        <TextAreaField
          id="product-notes"
          label="Notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          error={fieldErrors.notes}
          placeholder="What the product includes, who it is for, and any billing caveats."
          maxLength={2000}
        />
      </form>
    </Modal>
  );
}
