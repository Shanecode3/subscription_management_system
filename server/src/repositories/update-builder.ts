/**
 * Builds the `SET` fragment of an UPDATE from a partial patch object.
 *
 * Column names come from a fixed map declared by each repository, never from
 * request keys, so a request body can never inject SQL. Keys whose value is
 * `undefined` are skipped, which lets a partial schema express "leave it".
 */
export function buildUpdateSet<K extends string>(
  changes: Partial<Record<K, unknown>>,
  columns: Readonly<Record<K, string>>,
): { clause: string; values: unknown[] } {
  const assignments: string[] = [];
  const values: unknown[] = [];

  for (const key of Object.keys(changes) as K[]) {
    const value = changes[key];
    if (value === undefined) continue;

    const column = columns[key];
    if (!column) {
      throw new Error(`No column mapping for update key "${String(key)}".`);
    }

    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  }

  if (assignments.length === 0) {
    throw new Error('buildUpdateSet received no updatable fields.');
  }

  return { clause: assignments.join(', '), values };
}
