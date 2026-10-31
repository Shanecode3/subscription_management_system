import type { Plan } from './types';

export type PlanFlagKey = 'autoClose' | 'allowEarlyClose' | 'allowPause' | 'allowRenew';

export interface PlanFlagDefinition {
  key: PlanFlagKey;
  label: string;
  description: string;
}

/**
 * The lifecycle flags from the brief, described in the language of the person
 * configuring them. Both the plan cards and the plan form read this list, so a
 * new flag only has to be added once.
 */
export const PLAN_FLAGS: PlanFlagDefinition[] = [
  {
    key: 'autoClose',
    label: 'Auto close',
    description: 'Close automatically when the subscription end date is reached.',
  },
  {
    key: 'allowEarlyClose',
    label: 'Allow early close',
    description: 'A customer may close the subscription before its end date.',
  },
  {
    key: 'allowPause',
    label: 'Allow pause',
    description: 'The subscription can be paused and later resumed.',
  },
  {
    key: 'allowRenew',
    label: 'Allow renew',
    description: 'The subscription can be renewed when the term ends.',
  },
];

export function isFlagOn(plan: Plan, key: PlanFlagKey): boolean {
  return plan[key];
}
