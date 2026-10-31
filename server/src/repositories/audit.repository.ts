import type { PoolClient } from 'pg';
import { query } from '../db/pool';

export type AuditEntityType = 'USER' | 'PRODUCT' | 'PLAN' | 'SUBSCRIPTION' | 'INVOICE' | 'PAYMENT' | 'DISCOUNT';

/**
 * Append-only audit trail. Failures are logged but never surface to the caller:
 * an audit write must not turn a successful business action into a 500.
 */
export async function recordAuditEvent(
  event: {
    entityType: AuditEntityType;
    entityId: number;
    action: string;
    performedBy: number | null;
    details?: Record<string, unknown>;
  },
  client?: PoolClient,
): Promise<void> {
  const sql = `
    INSERT INTO audit_logs (entity_type, entity_id, action, performed_by, details)
    VALUES ($1, $2, $3, $4, $5)
  `;
  const params = [
    event.entityType,
    event.entityId,
    event.action,
    event.performedBy,
    event.details ? JSON.stringify(event.details) : null,
  ];

  if (client) {
    await client.query(sql, params);
    return;
  }
  await query(sql, params);
}
