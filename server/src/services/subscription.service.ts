import type { PoolClient } from 'pg';
import { withTransaction } from '../db/pool';
import { recordAuditEvent } from '../repositories/audit.repository';
import * as planRepository from '../repositories/plan.repository';
import * as subscriptionRepository from '../repositories/subscription.repository';
import * as templateRepository from '../repositories/template.repository';
import * as userRepository from '../repositories/user.repository';
import type { PlanRow } from '../repositories/plan.repository';
import type {
  NewSubscriptionLineInput,
  SubscriptionLineRow,
  SubscriptionRow,
} from '../repositories/subscription.repository';
import type { BillingInterval } from '../utils/catalog.validators';
import { todayIso } from '../utils/dates';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { toAmount } from '../utils/money';
import type {
  CreateSubscriptionInput,
  RenewSubscriptionInput,
  SubscriptionStatus,
  ToggleAddonInput,
  UpdateStatusInput,
} from '../utils/subscription.validators';
import { resolvePricedLine } from './product.service';
import type { Requester } from './requester';

// ---------------------------------------------------------------------------
// DTOs — what the API actually returns
// ---------------------------------------------------------------------------

export interface SubscriptionLineDto {
  id: number;
  productId: number;
  productName: string;
  productType: string;
  variantId: number | null;
  variantLabel: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxAmount: number;
  subtotal: number;
  totalAmount: number;
  isAddon: boolean;
  isAddonActive: boolean;
}

export interface SubscriptionFlags {
  autoClose: boolean;
  allowEarlyClose: boolean;
  allowPause: boolean;
  allowRenew: boolean;
}

export interface SubscriptionDto {
  id: number;
  subscriptionNumber: string;
  customerId: number;
  customerName: string;
  customerEmail: string;
  planId: number;
  planName: string;
  planPrice: number;
  billingInterval: BillingInterval;
  templateId: number | null;
  templateName: string | null;
  status: SubscriptionStatus;
  startDate: string;
  expiryDate: string | null;
  nextBillingDate: string | null;
  paymentTerms: string;
  notes: string | null;
  pausedAt: string | null;
  closedAt: string | null;
  flags: SubscriptionFlags;
  /** States this contract may move to next, already filtered by the plan flags. */
  allowedTransitions: SubscriptionStatus[];
  lines: SubscriptionLineDto[];
  subtotal: number;
  addonTotal: number;
  total: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

/**
 * The only legal moves. Anything else — skipping Confirmation, resuming a
 * Closed contract, pausing a Draft — is refused with the current state and the
 * list of valid next states, so the UI can explain itself instead of guessing.
 */
const TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  Draft: ['Quotation', 'Closed'],
  Quotation: ['Confirmed', 'Closed'],
  Confirmed: ['Active', 'Closed'],
  Active: ['Paused', 'Closed'],
  Paused: ['Active', 'Closed'],
  Closed: ['Active'],
};

const RENEWAL_INTERVAL: Record<BillingInterval, string> = {
  daily: '1 day',
  weekly: '7 days',
  monthly: '1 month',
  yearly: '1 year',
};

function latestIso(left: string, right: string): string {
  return left >= right ? left : right;
}

function flagViolation(row: SubscriptionRow, next: SubscriptionStatus): string | null {
  if (next === 'Paused' && !row.allow_pause) {
    return `The ${row.plan_name} plan does not allow pausing.`;
  }
  if (
    next === 'Closed' &&
    (row.status === 'Active' || row.status === 'Paused') &&
    !row.allow_early_close
  ) {
    return `The ${row.plan_name} plan does not allow early closure.`;
  }
  if (next === 'Active' && row.status === 'Closed' && !row.allow_renew) {
    return `The ${row.plan_name} plan does not allow renewal.`;
  }
  return null;
}

function allowedTransitionsFor(row: SubscriptionRow): SubscriptionStatus[] {
  return TRANSITIONS[row.status].filter((next) => flagViolation(row, next) === null);
}

// ---------------------------------------------------------------------------
// Row -> DTO
// ---------------------------------------------------------------------------

function toLineDto(row: SubscriptionLineRow): SubscriptionLineDto {
  const variantLabel =
    row.variant_attribute_name && row.variant_attribute_value
      ? `${row.variant_attribute_name}: ${row.variant_attribute_value}`
      : null;

  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    productType: row.product_type,
    variantId: row.variant_id,
    variantLabel,
    description: row.description,
    quantity: row.quantity,
    unitPrice: toAmount(row.unit_price),
    discountAmount: toAmount(row.discount_amount),
    taxAmount: toAmount(row.tax_amount),
    subtotal: toAmount(row.subtotal),
    totalAmount: toAmount(row.total_amount),
    isAddon: row.is_addon,
    isAddonActive: row.is_addon_active,
  };
}

export function toSubscriptionDto(
  row: SubscriptionRow,
  lines: SubscriptionLineRow[],
): SubscriptionDto {
  const billed = lines.filter((line) => !line.is_addon || line.is_addon_active);

  return {
    id: row.id,
    subscriptionNumber: row.subscription_number,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    planId: row.plan_id,
    planName: row.plan_name,
    planPrice: toAmount(row.plan_price),
    billingInterval: row.billing_interval,
    templateId: row.template_id,
    templateName: row.template_name,
    status: row.status,
    startDate: row.start_date,
    expiryDate: row.expiry_date,
    nextBillingDate: row.next_billing_date,
    paymentTerms: row.payment_terms,
    notes: row.notes,
    pausedAt: row.paused_at ? row.paused_at.toISOString() : null,
    closedAt: row.closed_at ? row.closed_at.toISOString() : null,
    flags: {
      autoClose: row.auto_close,
      allowEarlyClose: row.allow_early_close,
      allowPause: row.allow_pause,
      allowRenew: row.allow_renew,
    },
    allowedTransitions: allowedTransitionsFor(row),
    lines: lines.map(toLineDto),
    subtotal: toAmount(billed.reduce((sum, line) => sum + toAmount(line.subtotal), 0)),
    addonTotal: toAmount(
      billed.filter((line) => line.is_addon).reduce((sum, line) => sum + toAmount(line.subtotal), 0),
    ),
    total: toAmount(
      billed.reduce((sum, line) => sum + toAmount(line.total_amount), 0),
    ),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

function isInternal(requester: Requester): boolean {
  return requester.role === 'ADMIN' || requester.role === 'STAFF';
}

function assertInternal(requester: Requester, message: string): void {
  if (!isInternal(requester)) {
    throw new ForbiddenError(message);
  }
}

/**
 * A customer may only ever see their own contract. The response is 404 rather
 * than 403 so an id from another tenant is indistinguishable from one that
 * does not exist.
 */
function assertVisible(row: SubscriptionRow, requester: Requester): void {
  if (!isInternal(requester) && row.customer_id !== requester.id) {
    throw new NotFoundError('That subscription does not exist.');
  }
}

// ---------------------------------------------------------------------------
// Line assembly
// ---------------------------------------------------------------------------

function buildDescription(productName: string, variantLabel: string | null): string {
  const description = variantLabel ? `${productName} (${variantLabel})` : productName;
  return description.slice(0, 255);
}

function toNewLine(params: {
  productId: number;
  variantId: number | null;
  productName: string;
  variantLabel: string | null;
  quantity: number;
  unitPrice: number;
  isAddon: boolean;
}): NewSubscriptionLineInput {
  const unitPrice = toAmount(params.unitPrice);
  const subtotal = toAmount(unitPrice * params.quantity);

  return {
    productId: params.productId,
    variantId: params.variantId,
    description: buildDescription(params.productName, params.variantLabel),
    quantity: params.quantity,
    unitPrice,
    subtotal,
    totalAmount: subtotal,
    isAddon: params.isAddon,
  };
}

function assertPlanUsable(plan: PlanRow, field: 'planId' | 'templateId'): void {
  if (!plan.is_active) {
    throw new ValidationError(`"${plan.name}" is no longer active.`, [
      { field, message: 'Choose a plan that is still active.' },
    ]);
  }

  const today = todayIso();
  if (plan.available_from > today) {
    throw new ValidationError(`"${plan.name}" is not available until ${plan.available_from}.`, [
      { field, message: `This plan becomes available on ${plan.available_from}.` },
    ]);
  }
  if (plan.available_to !== null && plan.available_to < today) {
    throw new ValidationError(`"${plan.name}" stopped being available on ${plan.available_to}.`, [
      { field, message: `This plan is no longer on sale (ended ${plan.available_to}).` },
    ]);
  }
}

/**
 * The plan's minimum quantity is a contract floor, so it is checked on the
 * base lines only — an add-on must not be able to satisfy a minimum seat count.
 */
function assertMinimumQuantity(plan: PlanRow, lines: NewSubscriptionLineInput[]): void {
  const baseQuantity = lines
    .filter((line) => !line.isAddon)
    .reduce((sum, line) => sum + line.quantity, 0);

  if (baseQuantity < plan.min_quantity) {
    const message = `"${plan.name}" requires at least ${plan.min_quantity} base unit${
      plan.min_quantity === 1 ? '' : 's'
    }; this subscription has ${baseQuantity}.`;
    throw new ValidationError(message, [{ field: 'lines', message }]);
  }
}

async function buildFromTemplate(
  templateId: number,
): Promise<{ plan: PlanRow; lines: NewSubscriptionLineInput[] }> {
  const template = await templateRepository.findTemplateById(templateId);
  if (!template) {
    throw new ValidationError(`Quotation template #${templateId} does not exist.`, [
      { field: 'templateId', message: 'Choose an existing quotation template.' },
    ]);
  }

  const plan = await planRepository.findPlanById(template.plan_id);
  if (!plan) {
    throw new ValidationError('The plan behind this template no longer exists.', [
      { field: 'templateId', message: 'Choose a template whose plan still exists.' },
    ]);
  }
  assertPlanUsable(plan, 'templateId');

  const templateLines = await templateRepository.listLinesForTemplates([templateId]);
  if (templateLines.length === 0) {
    throw new ValidationError('That quotation template has no product lines.', [
      { field: 'templateId', message: 'Pick a template that contains at least one line.' },
    ]);
  }

  const lines = templateLines.map((line) =>
    toNewLine({
      productId: line.product_id,
      variantId: line.variant_id,
      productName: line.product_name,
      variantLabel:
        line.variant_attribute_name && line.variant_attribute_value
          ? `${line.variant_attribute_name}: ${line.variant_attribute_value}`
          : null,
      quantity: line.quantity,
      unitPrice: toAmount(line.unit_price),
      isAddon: line.product_type === 'Add-on',
    }),
  );

  assertMinimumQuantity(plan, lines);
  return { plan, lines };
}

async function buildManual(
  planId: number,
  inputLines: NonNullable<CreateSubscriptionInput['lines']>,
): Promise<{ plan: PlanRow; lines: NewSubscriptionLineInput[] }> {
  const plan = await planRepository.findPlanById(planId);
  if (!plan) {
    throw new ValidationError(`Plan #${planId} does not exist.`, [
      { field: 'planId', message: 'Choose an existing subscription plan.' },
    ]);
  }
  assertPlanUsable(plan, 'planId');

  const seen = new Set<string>();
  const lines: NewSubscriptionLineInput[] = [];

  for (const input of inputLines) {
    const variantId = input.variantId ?? null;
    const key = `${input.productId}:${variantId ?? 0}`;

    if (seen.has(key)) {
      throw new ValidationError(
        'The same product and variant appears twice — combine the quantities into one line.',
        [{ field: 'lines', message: `Product #${input.productId} is listed more than once.` }],
      );
    }
    seen.add(key);

    // Validates that the product is on sale and the variant belongs to it, and
    // supplies the catalogue price when the caller did not negotiate one.
    const resolved = await resolvePricedLine(input.productId, variantId);

    lines.push(
      toNewLine({
        productId: resolved.product.id,
        variantId: resolved.variant?.id ?? null,
        productName: resolved.product.name,
        variantLabel: resolved.variant
          ? `${resolved.variant.attribute_name}: ${resolved.variant.attribute_value}`
          : null,
        quantity: input.quantity,
        unitPrice: input.unitPrice ?? resolved.unitPrice,
        isAddon: resolved.product.type === 'Add-on',
      }),
    );
  }

  assertMinimumQuantity(plan, lines);
  return { plan, lines };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function reload(id: number, client: PoolClient): Promise<SubscriptionDto> {
  const row = await subscriptionRepository.findSubscriptionById(id, client);
  if (!row) {
    throw new NotFoundError('That subscription does not exist.');
  }
  const lines = await subscriptionRepository.listLinesForSubscription(id, client);
  return toSubscriptionDto(row, lines);
}

export async function listSubscriptions(
  requester: Requester,
  filter: { status?: SubscriptionStatus; customerId?: number },
): Promise<SubscriptionDto[]> {
  // The tenant rule is applied here, not trusted from the query string.
  const customerId = requester.role === 'CUSTOMER' ? requester.id : filter.customerId;

  const rows = await subscriptionRepository.listSubscriptions({ customerId, status: filter.status });
  const lines = await subscriptionRepository.listLinesForSubscriptions(rows.map((row) => row.id));

  const bySubscription = new Map<number, SubscriptionLineRow[]>();
  for (const line of lines) {
    const bucket = bySubscription.get(line.subscription_id);
    if (bucket) bucket.push(line);
    else bySubscription.set(line.subscription_id, [line]);
  }

  return rows.map((row) => toSubscriptionDto(row, bySubscription.get(row.id) ?? []));
}

export async function getSubscription(id: number, requester: Requester): Promise<SubscriptionDto> {
  const row = await subscriptionRepository.findSubscriptionById(id);
  if (!row) {
    throw new NotFoundError('That subscription does not exist.');
  }
  assertVisible(row, requester);

  const lines = await subscriptionRepository.listLinesForSubscription(id);
  return toSubscriptionDto(row, lines);
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export async function createSubscription(
  input: CreateSubscriptionInput,
  requester: Requester,
): Promise<SubscriptionDto> {
  assertInternal(requester, 'Only an Admin or Staff member can create subscriptions.');

  const customer = await userRepository.findPublicUserById(input.customerId);
  if (!customer || customer.role !== 'CUSTOMER' || !customer.is_active) {
    throw new ValidationError('Choose an active customer account.', [
      { field: 'customerId', message: 'That account is not an active customer.' },
    ]);
  }

  const { plan, lines } =
    input.templateId !== undefined
      ? await buildFromTemplate(input.templateId)
      : await buildManual(input.planId!, input.lines!);

  const expiryDate = input.expiryDate ?? null;
  const paymentTerms = input.paymentTerms ?? 'Immediate Payment';

  if (expiryDate !== null && expiryDate < input.startDate) {
    throw new ValidationError('Expiry date must be on or after the start date.', [
      { field: 'expiryDate', message: 'Expiry date must be on or after the start date.' },
    ]);
  }

  return withTransaction(async (client) => {
    const created = await subscriptionRepository.insertSubscription(
      {
        customerId: customer.id,
        planId: plan.id,
        templateId: input.templateId ?? null,
        startDate: input.startDate,
        expiryDate,
        paymentTerms,
        notes: input.notes && input.notes.trim() !== '' ? input.notes.trim() : null,
      },
      client,
    );

    await subscriptionRepository.insertSubscriptionLines(created.id, lines, client);

    await recordAuditEvent(
      {
        entityType: 'SUBSCRIPTION',
        entityId: created.id,
        action: 'SUBSCRIPTION_CREATED',
        performedBy: requester.id,
        details: {
          subscriptionNumber: created.subscription_number,
          customerId: customer.id,
          planId: plan.id,
          templateId: input.templateId ?? null,
          lineCount: lines.length,
        },
      },
      client,
    );

    return reload(created.id, client);
  });
}

// ---------------------------------------------------------------------------
// Lifecycle transitions
// ---------------------------------------------------------------------------

async function applyTransition(
  row: SubscriptionRow,
  next: SubscriptionStatus,
  requester: Requester,
  client: PoolClient,
  options: {
    reason?: string;
    startDate?: string | null;
    expiryDate?: string | null;
    paymentTerms?: string | null;
    action?: string;
  } = {},
): Promise<SubscriptionDto> {
  if (row.status === next) {
    throw new ValidationError(`This subscription is already ${next}.`, [
      { field: 'status', message: `It is already ${next}.` },
    ]);
  }

  const allowed = TRANSITIONS[row.status];
  if (!allowed.includes(next)) {
    const message = `A ${row.status} subscription cannot move to ${next}.`;
    throw new ValidationError(message, [
      { field: 'status', message: `From ${row.status} the next state can be ${allowed.join(' or ')}.` },
    ]);
  }

  const violation = flagViolation(row, next);
  if (violation) {
    throw new ValidationError(violation, [{ field: 'status', message: violation }]);
  }

  if (next === 'Active' && row.status === 'Closed') {
    // Renewal: the start date may be omitted, in which case the database uses
    // CURRENT_DATE and derives the expiry from the billing interval.
    await subscriptionRepository.renewSubscription(
      row.id,
      options.startDate ?? null,
      options.expiryDate ?? null,
      RENEWAL_INTERVAL[row.billing_interval],
      options.paymentTerms ?? null,
      client,
    );
  } else {
    const patch: subscriptionRepository.SubscriptionPatch = { status: next };

    if (next === 'Paused') {
      patch.pausedAt = new Date();
    }
    if (next === 'Active') {
      patch.pausedAt = null;
      // A contract paused past its billing date resumes as due today, never
      // with a date in the past that would bill several cycles at once.
      patch.nextBillingDate = latestIso(row.next_billing_date ?? row.start_date, todayIso());
    }
    if (next === 'Closed') {
      patch.closedAt = new Date();
    }

    await subscriptionRepository.updateSubscription(row.id, patch, client);
  }

  await recordAuditEvent(
    {
      entityType: 'SUBSCRIPTION',
      entityId: row.id,
      action: options.action ?? `SUBSCRIPTION_STATUS_${next.toUpperCase()}`,
      performedBy: requester.id,
      details: {
        subscriptionNumber: row.subscription_number,
        from: row.status,
        to: next,
        ...(options.reason ? { reason: options.reason } : {}),
      },
    },
    client,
  );

  return reload(row.id, client);
}

async function loadForAction(
  id: number,
  requester: Requester,
  client: PoolClient,
): Promise<SubscriptionRow> {
  const locked = await subscriptionRepository.lockSubscription(id, client);
  if (!locked) {
    throw new NotFoundError('That subscription does not exist.');
  }

  const row = await subscriptionRepository.findSubscriptionById(id, client);
  if (!row) {
    throw new NotFoundError('That subscription does not exist.');
  }

  assertVisible(row, requester);
  return row;
}

export async function transitionStatus(
  id: number,
  input: UpdateStatusInput,
  requester: Requester,
): Promise<SubscriptionDto> {
  assertInternal(requester, 'Only internal staff can move a subscription through its lifecycle.');

  return withTransaction(async (client) => {
    const row = await loadForAction(id, requester, client);
    return applyTransition(row, input.status, requester, client, { reason: input.reason });
  });
}

async function performLifecycle(
  id: number,
  next: SubscriptionStatus,
  requester: Requester,
  reason: string | undefined,
): Promise<SubscriptionDto> {
  return withTransaction(async (client) => {
    const row = await loadForAction(id, requester, client);
    return applyTransition(row, next, requester, client, { reason });
  });
}

export function pauseSubscription(
  id: number,
  requester: Requester,
  reason?: string,
): Promise<SubscriptionDto> {
  return performLifecycle(id, 'Paused', requester, reason);
}

export function resumeSubscription(
  id: number,
  requester: Requester,
  reason?: string,
): Promise<SubscriptionDto> {
  return performLifecycle(id, 'Active', requester, reason);
}

export function earlyCloseSubscription(
  id: number,
  requester: Requester,
  reason?: string,
): Promise<SubscriptionDto> {
  return performLifecycle(id, 'Closed', requester, reason);
}

export async function renewSubscription(
  id: number,
  input: RenewSubscriptionInput,
  requester: Requester,
): Promise<SubscriptionDto> {
  return withTransaction(async (client) => {
    const row = await loadForAction(id, requester, client);

    if (row.status !== 'Closed') {
      throw new ValidationError(`Only a closed subscription can be renewed; this one is ${row.status}.`, [
        { field: 'status', message: `A ${row.status} subscription is not closed.` },
      ]);
    }
    if (input.expiryDate && input.expiryDate < (input.startDate ?? todayIso())) {
      throw new ValidationError('New expiry date must be on or after the new start date.', [
        { field: 'expiryDate', message: 'Choose an expiry on or after the start date.' },
      ]);
    }

    return applyTransition(row, 'Active', requester, client, {
      startDate: input.startDate ?? null,
      expiryDate: input.expiryDate ?? null,
      paymentTerms: input.paymentTerms ?? null,
      action: 'SUBSCRIPTION_RENEWED',
    });
  });
}

// ---------------------------------------------------------------------------
// Add-on toggling
// ---------------------------------------------------------------------------

/**
 * Switching an add-on rewrites the line's stored subtotal and total, so every
 * later read — the portal, the staff view, the billing run — sees the same
 * amount without recomputing it in each place.
 */
export async function setAddon(
  subscriptionId: number,
  input: ToggleAddonInput,
  requester: Requester,
): Promise<SubscriptionDto> {
  return withTransaction(async (client) => {
    const row = await loadForAction(subscriptionId, requester, client);

    if (row.status !== 'Active') {
      throw new ValidationError('Add-ons can only be changed while the subscription is active.', [
        { field: 'status', message: `This subscription is ${row.status}.` },
      ]);
    }

    const lines = await subscriptionRepository.listLinesForSubscription(subscriptionId, client);
    const line = lines.find((candidate) => candidate.id === input.lineId);

    if (!line) {
      throw new ValidationError('That line does not belong to this subscription.', [
        { field: 'lineId', message: 'Choose a line from this subscription.' },
      ]);
    }
    if (!line.is_addon) {
      throw new ValidationError(`"${line.description}" is a core line and cannot be switched off.`, [
        { field: 'lineId', message: 'Only optional add-on lines can be toggled.' },
      ]);
    }

    await subscriptionRepository.updateAddonLine(line.id, input.isActive, client);

    await recordAuditEvent(
      {
        entityType: 'SUBSCRIPTION',
        entityId: row.id,
        action: input.isActive ? 'ADDON_ENABLED' : 'ADDON_DISABLED',
        performedBy: requester.id,
        details: {
          subscriptionNumber: row.subscription_number,
          lineId: line.id,
          description: line.description,
        },
      },
      client,
    );

    return reload(row.id, client);
  });
}
