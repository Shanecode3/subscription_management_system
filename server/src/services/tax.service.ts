import { withTransaction } from '../db/pool';
import { recordAuditEvent } from '../repositories/audit.repository';
import * as taxRepository from '../repositories/tax.repository';
import type { TaxRulePatch, TaxRuleRow } from '../repositories/tax.repository';
import type { CreateTaxRuleInput, UpdateTaxRuleInput } from '../utils/billing.validators';
import { ConflictError, ForbiddenError, NotFoundError } from '../utils/errors';
import { toAmount } from '../utils/money';
import type { Requester } from './requester';

export interface TaxRuleDto {
  id: number;
  name: string;
  rate: number;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
}

function assertAdmin(requester: Requester, message: string): void {
  if (requester.role !== 'ADMIN') {
    throw new ForbiddenError(message);
  }
}

export function toTaxRuleDto(row: TaxRuleRow): TaxRuleDto {
  return {
    id: row.id,
    name: row.name,
    rate: toAmount(row.rate),
    isActive: row.is_active,
    isDefault: row.is_default,
    createdAt: row.created_at.toISOString(),
  };
}

/** Customers see only the rates currently in force; the team sees everything. */
export async function listTaxRules(requester: Requester): Promise<TaxRuleDto[]> {
  const rows = await taxRepository.listTaxRules(requester.role === 'CUSTOMER');
  return rows.map(toTaxRuleDto);
}

export async function createTaxRule(
  input: CreateTaxRuleInput,
  requester: Requester,
): Promise<TaxRuleDto> {
  assertAdmin(requester, 'Only an Admin can create tax rules.');

  const duplicate = await taxRepository.findTaxRuleByName(input.name);
  if (duplicate) {
    throw new ConflictError(`A tax rule named "${input.name}" already exists.`, [
      { field: 'name', message: 'Tax rule names must be unique — choose a different name.' },
    ]);
  }

  const isDefault = input.isDefault ?? false;
  const isActive = input.isActive ?? true;

  if (isDefault && !isActive) {
    throw new ConflictError('An inactive tax rule cannot be the default.', [
      { field: 'isDefault', message: 'Activate the rule before making it the default.' },
    ]);
  }

  return withTransaction(async (client) => {
    // The partial unique index allows one default only, so the old one moves
    // aside inside the same transaction that creates the new one.
    if (isDefault) await taxRepository.clearDefaultTaxRule(client);

    const created = await taxRepository.insertTaxRule(
      { name: input.name, rate: input.rate, isActive, isDefault },
      client,
    );

    await recordAuditEvent(
      {
        entityType: 'TAX_RULE',
        entityId: created.id,
        action: 'TAX_RULE_CREATED',
        performedBy: requester.id,
        details: { name: created.name, rate: created.rate, isDefault: created.is_default },
      },
      client,
    );

    return toTaxRuleDto(created);
  });
}

export async function updateTaxRule(
  id: number,
  input: UpdateTaxRuleInput,
  requester: Requester,
): Promise<TaxRuleDto> {
  assertAdmin(requester, 'Only an Admin can edit tax rules.');

  const existing = await taxRepository.findTaxRuleById(id);
  if (!existing) {
    throw new NotFoundError('That tax rule does not exist.');
  }

  if (input.name !== undefined && input.name.toLowerCase() !== existing.name.toLowerCase()) {
    const duplicate = await taxRepository.findTaxRuleByName(input.name);
    if (duplicate && duplicate.id !== id) {
      throw new ConflictError(`A tax rule named "${input.name}" already exists.`, [
        { field: 'name', message: 'Tax rule names must be unique — choose a different name.' },
      ]);
    }
  }

  // Retiring a rule cannot leave it holding the default flag: billing looks up
  // an active default, and a dormant flag would silently disable taxes.
  const willBeActive = input.isActive ?? existing.is_active;
  if (!willBeActive && input.isDefault === true) {
    throw new ConflictError('An inactive tax rule cannot be the default.', [
      { field: 'isDefault', message: 'Activate the rule before making it the default.' },
    ]);
  }

  const patch: TaxRulePatch = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.rate !== undefined) patch.rate = input.rate;
  if (input.isActive !== undefined) patch.isActive = input.isActive;
  if (input.isDefault !== undefined) patch.isDefault = input.isDefault;
  if (!willBeActive && existing.is_default) patch.isDefault = false;

  return withTransaction(async (client) => {
    if (patch.isDefault === true) await taxRepository.clearDefaultTaxRule(client, id);

    const updated = await taxRepository.updateTaxRule(id, patch, client);
    if (!updated) throw new NotFoundError('That tax rule does not exist.');

    await recordAuditEvent(
      {
        entityType: 'TAX_RULE',
        entityId: updated.id,
        action: 'TAX_RULE_UPDATED',
        performedBy: requester.id,
        details: { changes: patch },
      },
      client,
    );

    return toTaxRuleDto(updated);
  });
}

/**
 * Retires a rate instead of deleting it. Historical invoice lines reference the
 * rule with ON DELETE RESTRICT, and a removed rate would make old invoices
 * unexplainable.
 */
export async function retireTaxRule(id: number, requester: Requester): Promise<TaxRuleDto> {
  assertAdmin(requester, 'Only an Admin can retire tax rules.');

  return withTransaction(async (client) => {
    const updated = await taxRepository.updateTaxRule(
      id,
      { isActive: false, isDefault: false },
      client,
    );
    if (!updated) throw new NotFoundError('That tax rule does not exist.');

    await recordAuditEvent(
      {
        entityType: 'TAX_RULE',
        entityId: updated.id,
        action: 'TAX_RULE_RETIRED',
        performedBy: requester.id,
        details: { name: updated.name },
      },
      client,
    );

    return toTaxRuleDto(updated);
  });
}
