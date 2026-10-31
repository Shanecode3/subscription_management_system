/**
 * Builds the SQL expression for a human-readable document number such as
 * `INV-2026-1042`.
 *
 * The obvious form, `lpad(nextval(seq)::text, 4, '0')`, is subtly wrong:
 * PostgreSQL's `lpad` *truncates* when the value is already longer than the
 * target width, so the ten-thousandth document would silently reuse the
 * previous four digits and collide with `uq_invoice_number`. This expression
 * calls `nextval` exactly once (never twice — that would burn a number) and
 * pads only while the value is shorter than the minimum width.
 *
 * Both arguments are code constants, never request data, so interpolating them
 * here cannot widen the SQL surface.
 */
export function documentNumberExpression(prefix: string, sequence: string, width = 4): string {
  return `'${prefix}-' || to_char(CURRENT_DATE, 'YYYY') || '-' ||
    (SELECT lpad(value::text, GREATEST(${width}, length(value::text)), '0')
       FROM (SELECT nextval('${sequence}') AS value) AS next_document)`;
}
