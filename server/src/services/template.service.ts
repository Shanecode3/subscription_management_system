import { withTransaction } from '../db/pool';
import { recordAuditEvent } from '../repositories/audit.repository';
import * as planRepository from '../repositories/plan.repository';
import * as templateRepository from '../repositories/template.repository';
import type {
  NewTemplateLineInput,
  TemplateLineRow,
  TemplateRow,
} from '../repositories/template.repository';
import type { CreateTemplateInput } from '../utils/catalog.validators';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { toAmount } from '../utils/money';
import { resolvePricedLine } from './product.service';
import type { Requester } from './requester';

export interface TemplateLineDto {
  id: number;
  productId: number;
  productName: string;
  variantId: number | null;
  /** "Brand: Odoo" — null when the line has no variant. */
  variantLabel: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface QuotationTemplateDto {
  id: number;
  name: string;
  planId: number;
  planName: string;
  planBillingInterval: string;
  validityDays: number;
  notes: string | null;
  lines: TemplateLineDto[];
  lineCount: number;
  /** Sum of the line totals at template prices — a preview, not an invoice total. */
  totalValue: number;
  createdAt: string;
  updatedAt: string;
}

function toLineDto(row: TemplateLineRow): TemplateLineDto {
  const unitPrice = toAmount(row.unit_price);
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
    quantity: row.quantity,
    unitPrice,
    lineTotal: toAmount(unitPrice * row.quantity),
  };
}

function toTemplateDto(row: TemplateRow, lines: TemplateLineRow[]): QuotationTemplateDto {
  const lineDtos = lines.map(toLineDto);
  return {
    id: row.id,
    name: row.name,
    planId: row.plan_id,
    planName: row.plan_name,
    planBillingInterval: row.plan_billing_interval,
    validityDays: row.validity_days,
    notes: row.notes,
    lines: lineDtos,
    lineCount: lineDtos.length,
    totalValue: toAmount(lineDtos.reduce((sum, line) => sum + line.lineTotal, 0)),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** One query for templates plus one for all of their lines. */
async function withLines(rows: TemplateRow[]): Promise<QuotationTemplateDto[]> {
  const lines = await templateRepository.listLinesForTemplates(rows.map((row) => row.id));

  const byTemplate = new Map<number, TemplateLineRow[]>();
  for (const line of lines) {
    const bucket = byTemplate.get(line.template_id);
    if (bucket) bucket.push(line);
    else byTemplate.set(line.template_id, [line]);
  }

  return rows.map((row) => toTemplateDto(row, byTemplate.get(row.id) ?? []));
}

function assertInternal(requester: Requester): void {
  // Quotation templates are internal sales tooling — customers never see them.
  if (requester.role !== 'ADMIN' && requester.role !== 'STAFF') {
    throw new ForbiddenError('Quotation templates are available to internal staff only.');
  }
}

export async function listTemplates(requester: Requester): Promise<QuotationTemplateDto[]> {
  assertInternal(requester);
  return withLines(await templateRepository.listTemplates());
}

export async function getTemplate(
  id: number,
  requester: Requester,
): Promise<QuotationTemplateDto> {
  assertInternal(requester);

  const row = await templateRepository.findTemplateById(id);
  if (!row) {
    throw new NotFoundError('That quotation template does not exist.');
  }

  const [dto] = await withLines([row]);
  return dto!;
}

export async function createTemplate(
  input: CreateTemplateInput,
  requester: Requester,
): Promise<QuotationTemplateDto> {
  if (requester.role !== 'ADMIN') {
    throw new ForbiddenError('Only an Admin can create quotation templates.');
  }

  const duplicate = await templateRepository.findTemplateByName(input.name);
  if (duplicate) {
    throw new ConflictError(`A quotation template named "${input.name}" already exists.`, [
      { field: 'name', message: 'Template names must be unique — choose a different name.' },
    ]);
  }

  const plan = await planRepository.findPlanById(input.planId);
  if (!plan) {
    throw new ValidationError(`Plan #${input.planId} does not exist.`, [
      { field: 'planId', message: 'Choose an existing subscription plan.' },
    ]);
  }
  if (!plan.is_active) {
    throw new ValidationError(`"${plan.name}" is no longer active.`, [
      { field: 'planId', message: 'Choose a plan that is still active.' },
    ]);
  }

  const seen = new Set<string>();
  const lines: NewTemplateLineInput[] = [];

  for (const line of input.lines) {
    const variantId = line.variantId ?? null;
    const lineKey = `${line.productId}:${variantId ?? 0}`;

    if (seen.has(lineKey)) {
      throw new ValidationError(
        'The same product and variant appears more than once — combine the quantities into one line.',
        [
          {
            field: 'lines',
            message: `Product #${line.productId} with variant #${variantId ?? 'none'} is listed twice.`,
          },
        ],
      );
    }
    seen.add(lineKey);

    // Validates the product exists and is active, and that the variant belongs
    // to that product. Also produces the server-side default unit price, so the
    // "+560 for the Odoo brand" rule cannot be skipped by a stale client.
    const resolved = await resolvePricedLine(line.productId, variantId);

    lines.push({
      productId: line.productId,
      variantId,
      quantity: line.quantity,
      unitPrice: line.unitPrice ?? resolved.unitPrice,
    });
  }

  const templateId = await withTransaction(async (client) => {
    const created = await templateRepository.insertTemplate(
      {
        name: input.name,
        planId: input.planId,
        validityDays: input.validityDays,
        notes: input.notes && input.notes.trim() !== '' ? input.notes.trim() : null,
      },
      client,
    );

    await templateRepository.insertTemplateLines(created.id, lines, client);

    await recordAuditEvent(
      {
        entityType: 'QUOTATION_TEMPLATE',
        entityId: created.id,
        action: 'TEMPLATE_CREATED',
        performedBy: requester.id,
        details: {
          name: input.name,
          planId: input.planId,
          lineCount: lines.length,
        },
      },
      client,
    );

    return created.id;
  });

  const row = await templateRepository.findTemplateById(templateId);
  if (!row) {
    throw new Error('Template was created but could not be reloaded.');
  }

  const [dto] = await withLines([row]);
  return dto!;
}
