/** Joins truthy class names. Keeps conditional Tailwind lists readable. */
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
