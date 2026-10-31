import type { PoolClient } from 'pg';
import { withTransaction } from '../db/pool';
import { recordAuditEvent } from '../repositories/audit.repository';
import * as discountRepository from '../repositories/discount.repository';
import type {
  DiscountRulePatch,
  DiscountRuleRow,
} from '../repositories/discount.repository';
import * as productRepository from '../repositories/product.repository';
import type {
  CreateDiscountRuleInput,
  DiscountType,
  UpdateDiscountRuleInput,
} from '../utils/billing.validators';
import { todayIso } from '../utils/dates';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { toAmount } from '../utils/money';
import type { Requester } from './requester';

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export type DiscountStanding = 'Active' | 'Scheduled' | 'Expired' | 'Exhausted' | 'Inactive';

export interface DiscountRuleDto {
  id: number;
  name: string;
  code: string;
  discountType: DiscountType;
  discountValue: number;
  scope: 'whole_subscription' | 'specific_product';
  targetProductId: number | null;
  targetProductName: string | null;
  minPurchaseAmount: number;
  minQuantity: number;
  startDate: string;
  endDate: string;
  maxUses: number;
  currentUses: number;
  usesRemaining: number;
  isActive: boolean;
  /** Derived standing, so the UI never re-implements the expiry rules. */
  standing: DiscountStanding;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

/** A billable line as the discount engine sees it. */
export interface DiscountLineInput {
  productId: number;
  quantity: number;
  unitPrice: number;
}

export interface DiscountComputation {
  rule: DiscountRuleRow;
  /** Total discount in currency units. */
  amount: number;
  /** Per input line, in the same order as the lines passed in. */
  perLine: number[];
}

function assertAdmin(requester: Requester, message: string): void {
  if (requester.role !== 'ADMIN') {
    throw new ForbiddenError(message);
  }
}

function standingOf(row: DiscountRuleRow, today: string): DiscountStanding {
  if (!row.is_active) return 'Inactive';
  if (row.current_uses >= row.max_uses) return 'Exhausted';
  if (row.start_date > today) return 'Scheduled';
  if (row.end_date < today) return 'Expired';
  return 'Active';
}

export function toDiscountRuleDto(row: DiscountRuleRow): DiscountRuleDto {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    discountType: row.discount_type,
    discountValue: toAmount(row.discount_value),
    scope: row.scope,
    targetProductId: row.target_product_id,
    targetProductName: row.target_product_name,
    minPurchaseAmount: toAmount(row.min_purchase_amount),
    minQuantity: row.min_quantity,
    startDate: row.start_date,
    endDate: row.end_date,
    maxUses: row.max_uses,
    currentUses: row.current_uses,
    usesRemaining: Math.max(0, row.max_uses - row.current_uses),
    isActive: row.is_active,
    standing: standingOf(row, todayIso()),
    createdByName: row.created_by_name,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Discount arithmetic (pure, shared by preview, billing and tests)
// ---------------------------------------------------------------------------

const toCents = (amount: number): number => Math.round(amount * 100);
const fromCents = (cents: number): number => cents / 100;

/**
 * Allocates `totalCents` across participants proportionally to their amounts,
 * using the largest-remainder method so the parts always add up to the whole.
 * A one-cent floor is never left behind, and no line is ever discounted below
 * zero: an allocation can never exceed the line's own amount.
 */
function allocate(totalCents: number, amountsCents: number[]): number[] {
  const result = new Array<number>(amountsCents.length).fill(0);
  const base = amountsCents.reduce((sum, amount) => sum + amount, 0);
  if (totalCents <= 0 || base <= 0) return result;

  const remainders: { index: number; fraction: number }[] = [];
  let allocated = 0;

  amountsCents.forEach((amount, index) => {
    const exact = (totalCents * amount) / base;
    const floor = Math.floor(exact);
    result[index] = floor;
    allocated += floor;
    remainders.push({ index, fraction: exact - floor });
  });

  let left = totalCents - allocated;
  remainders.sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (const { index } of remainders) {
    if (left <= 0) break;
    if (result[index]! < amountsCents[index]!) {
      result[index]! += 1;
      left -= 1;
    }
  }

  return result;
}

/**
 * Computes what one rule would take off a set of lines, or null when the rule
 * does not apply: thresholds unmet, scope has no matching line, or the result
 * is zero.
 *
 * The arithmetic is integer cents so a 10% discount on 3 × 33.33 is 10.00 and
 * never 9.9999999.
 */
export function computeDiscountForRule(
  rule: DiscountRuleRow,
  lines: DiscountLineInput[],
): DiscountComputation | null {
  if (lines.length === 0) return null;

  const lineAmounts = lines.map((line) => toCents(line.unitPrice) * line.quantity);
  const subtotalCents = lineAmounts.reduce((sum, amount) => sum + amount, 0);
  const totalQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);

  if (subtotalCents < toCents(toAmount(rule.min_purchase_amount))) return null;
  if (totalQuantity < rule.min_quantity) return null;

  const participantIndexes =
    rule.scope === 'specific_product'
      ? lines
          .map((line, index) => (line.productId === rule.target_product_id ? index : -1))
          .filter((index) => index >= 0)
      : lines.map((_, index) => index);

  if (participantIndexes.length === 0) return null;

  const participantAmounts = participantIndexes.map((index) => lineAmounts[index]!);
  const baseCents = participantAmounts.reduce((sum, amount) => sum + amount, 0);
  if (baseCents <= 0) return null;

  const discountValue = toAmount(rule.discount_value);
  const rawCents =
    rule.discount_type === 'percentage'
      ? Math.round((baseCents * discountValue) / 100)
      : Math.min(toCents(discountValue), baseCents);

  if (rawCents <= 0) return null;

  const shares = allocate(rawCents, participantAmounts);
  const perLineCents = new Array<number>(lines.length).fill(0);
  participantIndexes.forEach((lineIndex, shareIndex) => {
    perLineCents[lineIndex] = shares[shareIndex] ?? 0;
  });

  return {
    rule,
    amount: fromCents(rawCents),
    perLine: perLineCents.map(fromCents),
  };
}

/**
 * Every applicable rule ranked best-first. Billing walks this list and claims
 * the first rule whose usage it can successfully consume, so an exhausted rule
 * never blocks a smaller discount that is still valid.
 */
export function rankApplicableDiscounts(
  rules: DiscountRuleRow[],
  lines: DiscountLineInput[],
): DiscountComputation[] {
  return rules
    .map((rule) => computeDiscountForRule(rule, lines))
    .filter((computation): computation is DiscountComputation => computation !== null)
    .sort((left, right) => toCents(right.amount) - toCents(left.amount) || left.rule.id - right.rule.id);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function assertInternal(requester: Requester): void {
  if (requester.role === 'CUSTOMER') {
    throw new ForbiddenError('Discount rules are visible to Brightloop staff only.');
  }
}

export async function listDiscountRules(requester: Requester): Promise<DiscountRuleDto[]> {
  assertInternal(requester);
  const rows = await discountRepository.listDiscountRules();
  return rows.map(toDiscountRuleDto);
}

// ---------------------------------------------------------------------------
// Admin authoring
// ---------------------------------------------------------------------------

/**
 * A rule can never discount again once it is retired, has passed its end date
 * or has consumed its last use. A rule whose window has not opened yet is not
 * dead — it stays attached and becomes usable on its start date.
 */
function canNeverApplyAgain(rule: DiscountRuleRow): boolean {
  return !rule.is_active || rule.end_date < todayIso() || rule.current_uses >= rule.max_uses;
}

/** Removes a dead rule from every contract, so no screen offers it again. */
async function detachIfDead(rule: DiscountRuleRow, client: PoolClient): Promise<number> {
  if (!canNeverApplyAgain(rule)) return 0;
  return discountRepository.detachFromSubscriptions(rule.id, client);
}

async function assertProductUsable(productId: number): Promise<void> {
  const product = await productRepository.findProductById(productId);
  if (!product) {
    throw new ValidationError(`Product #${productId} does not exist.`, [
      { field: 'targetProductId', message: 'Choose an existing product.' },
    ]);
  }
  if (!product.is_active) {
    throw new ValidationError(`"${product.name}" is no longer available.`, [
      { field: 'targetProductId', message: 'Choose a product that is still active.' },
    ]);
  }
}

export async function createDiscountRule(
  input: CreateDiscountRuleInput,
  requester: Requester,
): Promise<DiscountRuleDto> {
  assertAdmin(requester, 'Only an Admin can create discount rules.');

  const duplicate = await discountRepository.findDiscountRuleByCode(input.code);
  if (duplicate) {
    throw new ConflictError(`A discount with code "${input.code}" already exists.`, [
      { field: 'code', message: 'Discount codes must be unique — choose a different code.' },
    ]);
  }

  const targetProductId = input.scope === 'specific_product' ? input.targetProductId! : null;
  if (targetProductId !== null) await assertProductUsable(targetProductId);

  return withTransaction(async (client) => {
    const created = await discountRepository.insertDiscountRule(
      {
        name: input.name,
        code: input.code,
        discountType: input.discountType,
        discountValue: input.discountValue,
        scope: input.scope,
        targetProductId,
        minPurchaseAmount: input.minPurchaseAmount ?? 0,
        minQuantity: input.minQuantity ?? 0,
        startDate: input.startDate,
        endDate: input.endDate,
        maxUses: input.maxUses ?? 100,
        createdBy: requester.id,
      },
      client,
    );

    await recordAuditEvent(
      {
        entityType: 'DISCOUNT',
        entityId: created.id,
        action: 'DISCOUNT_RULE_CREATED',
        performedBy: requester.id,
        details: {
          code: created.code,
          type: created.discount_type,
          value: created.discount_value,
          scope: created.scope,
          maxUses: created.max_uses,
          window: `${created.start_date} → ${created.end_date}`,
        },
      },
      client,
    );

    return toDiscountRuleDto(created);
  });
}

export async function updateDiscountRule(
  id: number,
  input: UpdateDiscountRuleInput,
  requester: Requester,
): Promise<DiscountRuleDto> {
  assertAdmin(requester, 'Only an Admin can edit discount rules.');

  const existing = await discountRepository.findDiscountRuleById(id);
  if (!existing) {
    throw new NotFoundError('That discount rule does not exist.');
  }

  if (input.code !== undefined && input.code !== existing.code) {
    const duplicate = await discountRepository.findDiscountRuleByCode(input.code);
    if (duplicate && duplicate.id !== id) {
      throw new ConflictError(`A discount with code "${input.code}" already exists.`, [
        { field: 'code', message: 'Discount codes must be unique — choose a different code.' },
      ]);
    }
  }

  const discountType = input.discountType ?? existing.discount_type;
  const discountValue = input.discountValue ?? toAmount(existing.discount_value);
  const scope = input.scope ?? existing.scope;
  const startDate = input.startDate ?? existing.start_date;
  const endDate = input.endDate ?? existing.end_date;
  const maxUses = input.maxUses ?? existing.max_uses;

  if (discountType === 'percentage' && discountValue > 100) {
    throw new ValidationError('A percentage discount cannot exceed 100%.', [
      { field: 'discountValue', message: 'Enter a percentage between 0 and 100.' },
    ]);
  }
  if (endDate < startDate) {
    throw new ValidationError('End date must be on or after the start date.', [
      { field: 'endDate', message: 'Choose an end date on or after the start date.' },
    ]);
  }
  if (maxUses < existing.current_uses) {
    throw new ValidationError(
      `Maximum uses cannot be lower than the ${existing.current_uses} uses already recorded.`,
      [{ field: 'maxUses', message: `Choose ${existing.current_uses} or more.` }],
    );
  }

  const patch: DiscountRulePatch = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.code !== undefined) patch.code = input.code;
  if (input.discountType !== undefined) patch.discountType = input.discountType;
  if (input.discountValue !== undefined) patch.discountValue = input.discountValue;
  if (input.scope !== undefined) patch.scope = input.scope;
  if (input.minPurchaseAmount !== undefined) patch.minPurchaseAmount = input.minPurchaseAmount;
  if (input.minQuantity !== undefined) patch.minQuantity = input.minQuantity;
  if (input.startDate !== undefined) patch.startDate = input.startDate;
  if (input.endDate !== undefined) patch.endDate = input.endDate;
  if (input.maxUses !== undefined) patch.maxUses = input.maxUses;
  if (input.isActive !== undefined) patch.isActive = input.isActive;

  // Scope and target move together: the CHECK constraint on discount_rules
  // requires exactly one to be present for 'specific_product' and none for
  // 'whole_subscription'.
  if (scope === 'whole_subscription') {
    if (input.targetProductId != null) {
      throw new ValidationError('A whole-subscription discount does not target a single product.', [
        { field: 'targetProductId', message: 'Leave the target product empty for this scope.' },
      ]);
    }
    if (input.scope !== undefined) patch.targetProductId = null;
  } else {
    const targetChanged =
      (input.targetProductId !== undefined &&
        input.targetProductId !== existing.target_product_id) ||
      (input.scope !== undefined && input.scope !== existing.scope);
    const targetProductId =
      input.targetProductId !== undefined ? input.targetProductId : existing.target_product_id;
    if (targetProductId == null) {
      throw new ValidationError('Choose the product this discount applies to.', [
        { field: 'targetProductId', message: 'A product discount needs a target product.' },
      ]);
    }
    if (targetChanged) {
      await assertProductUsable(targetProductId);
      patch.targetProductId = targetProductId;
    }
  }

  // A body whose only key normalises away (for example targetProductId: null
  // on a whole-subscription rule) would otherwise reach the repository as an
  // empty SET clause and surface as a 500.
  if (Object.keys(patch).length === 0) {
    throw new ValidationError('Provide at least one field to update.', [
      { field: 'name', message: 'Nothing in this request would change the rule.' },
    ]);
  }

  return withTransaction(async (client) => {
    const updated = await discountRepository.updateDiscountRule(id, patch, client);
    if (!updated) throw new NotFoundError('That discount rule does not exist.');

    const detached = await detachIfDead(updated, client);

    await recordAuditEvent(
      {
        entityType: 'DISCOUNT',
        entityId: updated.id,
        action: 'DISCOUNT_RULE_UPDATED',
        performedBy: requester.id,
        details: { changes: patch, detachedSubscriptions: detached },
      },
      client,
    );

    return toDiscountRuleDto(updated);
  });
}

/** Deactivates a rule immediately; invoices already issued keep their snapshot. */
export async function retireDiscountRule(
  id: number,
  requester: Requester,
): Promise<DiscountRuleDto> {
  assertAdmin(requester, 'Only an Admin can retire discount rules.');

  return withTransaction(async (client) => {
    const updated = await discountRepository.updateDiscountRule(id, { isActive: false }, client);
    if (!updated) throw new NotFoundError('That discount rule does not exist.');

    const detached = await detachIfDead(updated, client);

    await recordAuditEvent(
      {
        entityType: 'DISCOUNT',
        entityId: updated.id,
        action: 'DISCOUNT_RULE_RETIRED',
        performedBy: requester.id,
        details: { code: updated.code, detachedSubscriptions: detached },
      },
      client,
    );

    return toDiscountRuleDto(updated);
  });
}

/**
 * Loads the candidate rules for a billing transaction. Exposed here so the
 * engine never imports the repository directly for business selection.
 */
export function listApplicableDiscounts(
  client?: PoolClient,
): Promise<DiscountRuleRow[]> {
  return discountRepository.listApplicableDiscountRules(client);
}

/**
 * Claims a use of the chosen rule atomically. A null result means the rule's
 * last use was taken (or it expired) between selection and now; the returned
 * counters let the caller notice that the rule just used its last allowance.
 */
export function claimDiscountUse(
  ruleId: number,
  client: PoolClient,
): Promise<{ currentUses: number; maxUses: number } | null> {
  return discountRepository
    .consumeDiscountUse(ruleId, client)
    .then((row) => (row ? { currentUses: row.current_uses, maxUses: row.max_uses } : null));
}

/** Clears a rule that can never apply again from every contract pointing at it. */
export function detachDiscountRule(ruleId: number, client: PoolClient): Promise<number> {
  return discountRepository.detachFromSubscriptions(ruleId, client);
}
