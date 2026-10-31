import { withTransaction } from '../db/pool';
import { recordAuditEvent } from '../repositories/audit.repository';
import * as planRepository from '../repositories/plan.repository';
import type { PlanPatch, PlanRow } from '../repositories/plan.repository';
import type { BillingInterval, CreatePlanInput, UpdatePlanInput } from '../utils/catalog.validators';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { toAmount } from '../utils/money';
import type { Requester } from './requester';

export interface PlanDto {
  id: number;
  name: string;
  price: number;
  billingInterval: BillingInterval;
  minQuantity: number;
  availableFrom: string;
  availableTo: string | null;
  autoClose: boolean;
  allowEarlyClose: boolean;
  allowPause: boolean;
  allowRenew: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toPlanDto(row: PlanRow): PlanDto {
  return {
    id: row.id,
    name: row.name,
    price: toAmount(row.price),
    billingInterval: row.billing_interval,
    minQuantity: row.min_quantity,
    availableFrom: row.available_from,
    availableTo: row.available_to,
    autoClose: row.auto_close,
    allowEarlyClose: row.allow_early_close,
    allowPause: row.allow_pause,
    allowRenew: row.allow_renew,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function assertAdmin(requester: Requester, message: string): void {
  if (requester.role !== 'ADMIN') {
    throw new ForbiddenError(message);
  }
}

export async function listPlans(requester: Requester): Promise<PlanDto[]> {
  // The brief: a customer sees only plans that are on sale right now.
  const rows = await planRepository.listPlans(requester.role === 'CUSTOMER');
  return rows.map(toPlanDto);
}

export async function getPlan(id: number, requester: Requester): Promise<PlanDto> {
  const plan = await planRepository.findPlanById(id);
  if (!plan || (requester.role === 'CUSTOMER' && !plan.is_active)) {
    throw new NotFoundError('That plan does not exist.');
  }
  return toPlanDto(plan);
}

export async function createPlan(input: CreatePlanInput, requester: Requester): Promise<PlanDto> {
  assertAdmin(requester, 'Only an Admin can create subscription plans.');

  const duplicate = await planRepository.findPlanByName(input.name);
  if (duplicate) {
    throw new ConflictError(`A plan named "${input.name}" already exists.`, [
      { field: 'name', message: 'Plan names must be unique — choose a different name.' },
    ]);
  }

  return withTransaction(async (client) => {
    const created = await planRepository.insertPlan(
      {
        name: input.name,
        price: input.price,
        billingInterval: input.billingInterval,
        minQuantity: input.minQuantity ?? 1,
        availableFrom: input.availableFrom,
        availableTo: input.availableTo ?? null,
        // Defaults mirror the schema so the API and the database agree.
        autoClose: input.autoClose ?? false,
        allowEarlyClose: input.allowEarlyClose ?? true,
        allowPause: input.allowPause ?? true,
        allowRenew: input.allowRenew ?? true,
      },
      client,
    );

    await recordAuditEvent(
      {
        entityType: 'PLAN',
        entityId: created.id,
        action: 'PLAN_CREATED',
        performedBy: requester.id,
        details: {
          name: created.name,
          price: created.price,
          billingInterval: created.billing_interval,
        },
      },
      client,
    );

    return toPlanDto(created);
  });
}

export async function updatePlan(
  id: number,
  input: UpdatePlanInput,
  requester: Requester,
): Promise<PlanDto> {
  assertAdmin(requester, 'Only an Admin can edit subscription plans.');

  const existing = await planRepository.findPlanById(id);
  if (!existing) {
    throw new NotFoundError('That plan does not exist.');
  }

  if (input.name !== undefined && input.name.toLowerCase() !== existing.name.toLowerCase()) {
    const duplicate = await planRepository.findPlanByName(input.name);
    if (duplicate && duplicate.id !== id) {
      throw new ConflictError(`A plan named "${input.name}" already exists.`, [
        { field: 'name', message: 'Plan names must be unique — choose a different name.' },
      ]);
    }
  }

  // A contract keeps no copy of the interval it was sold on, so changing the
  // plan would silently retime every live subscription and the next billing
  // date it holds. Live contracts finish on their terms; new ones get the edit.
  if (input.billingInterval !== undefined && input.billingInterval !== existing.billing_interval) {
    const live = await planRepository.countLiveSubscriptions(id);
    if (live > 0) {
      throw new ConflictError(
        `${live} live subscription${live === 1 ? '' : 's'} bill on this plan's current interval. Retire the plan and create a new one instead of changing its interval.`,
        [{ field: 'billingInterval', message: 'This plan still has live subscriptions.' }],
      );
    }
  }

  // A partial update can still create an impossible window, so compare the
  // merged result rather than only the fields that arrived.
  const nextFrom = input.availableFrom ?? existing.available_from;
  const nextTo = input.availableTo === undefined ? existing.available_to : input.availableTo;
  if (nextTo !== null && nextTo < nextFrom) {
    throw new ValidationError('Available-to date must be on or after the available-from date.', [
      {
        field: 'availableTo',
        message: 'Available-to date must be on or after the available-from date.',
      },
    ]);
  }

  const patch: PlanPatch = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.price !== undefined) patch.price = input.price;
  if (input.billingInterval !== undefined) patch.billingInterval = input.billingInterval;
  if (input.minQuantity !== undefined) patch.minQuantity = input.minQuantity;
  if (input.availableFrom !== undefined) patch.availableFrom = input.availableFrom;
  if (input.availableTo !== undefined) patch.availableTo = input.availableTo;
  if (input.autoClose !== undefined) patch.autoClose = input.autoClose;
  if (input.allowEarlyClose !== undefined) patch.allowEarlyClose = input.allowEarlyClose;
  if (input.allowPause !== undefined) patch.allowPause = input.allowPause;
  if (input.allowRenew !== undefined) patch.allowRenew = input.allowRenew;
  // Restoring a retired plan is a PATCH of the same flag the DELETE cleared,
  // so the plan screen has one affordance per direction.
  if (input.isActive !== undefined) patch.isActive = input.isActive;

  return withTransaction(async (client) => {
    const updated = await planRepository.updatePlan(id, patch, client);
    if (!updated) throw new NotFoundError('That plan does not exist.');

    await recordAuditEvent(
      {
        entityType: 'PLAN',
        entityId: updated.id,
        action: 'PLAN_UPDATED',
        performedBy: requester.id,
        details: { changes: patch },
      },
      client,
    );

    return toPlanDto(updated);
  });
}

export async function deactivatePlan(id: number, requester: Requester): Promise<PlanDto> {
  assertAdmin(requester, 'Only an Admin can retire subscription plans.');

  const existing = await planRepository.findPlanById(id);
  if (!existing) {
    throw new NotFoundError('That plan does not exist.');
  }

  return withTransaction(async (client) => {
    const updated = await planRepository.updatePlan(id, { isActive: false }, client);
    if (!updated) throw new NotFoundError('That plan does not exist.');

    await recordAuditEvent(
      {
        entityType: 'PLAN',
        entityId: updated.id,
        action: 'PLAN_DEACTIVATED',
        performedBy: requester.id,
        details: { name: updated.name },
      },
      client,
    );

    return toPlanDto(updated);
  });
}
