import { cx } from '../../lib/cx';
import { flowIndex, MAIN_FLOW } from '../../lib/subscription-status';
import type { SubscriptionStatus } from '../../lib/types';

/**
 * The contract's progression, always visible so a team can see at a glance how
 * far a subscription has travelled and what is still ahead. A paused contract
 * replaces the Active step rather than adding a sixth milestone.
 */
export function StatusStepper({ status }: { status: SubscriptionStatus }) {
  const index = flowIndex(status);

  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2" aria-label={`Subscription status: ${status}`}>
      {MAIN_FLOW.map((step, position) => {
        const isDone = position < index;
        const isCurrent = position === index;
        const isPausedHere = isCurrent && status === 'Paused';
        const label = isPausedHere ? 'Paused' : step;

        return (
          <li key={step} className="flex items-center gap-1">
            {position > 0 ? (
              <span
                aria-hidden="true"
                className={cx(
                  'h-px w-3 sm:w-5',
                  isDone || isCurrent ? 'bg-plum-300' : 'bg-slate-200',
                )}
              />
            ) : null}

            <span
              aria-current={isCurrent ? 'step' : undefined}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
                isPausedHere
                  ? 'bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-200'
                  : isCurrent
                    ? 'bg-plum-100 text-plum-800 ring-1 ring-inset ring-plum-200'
                    : isDone
                      ? 'text-plum-700'
                      : 'text-slate-400',
              )}
            >
              <span
                aria-hidden="true"
                className={cx(
                  'h-1.5 w-1.5 rounded-full',
                  isPausedHere
                    ? 'bg-amber-500'
                    : isDone || isCurrent
                      ? 'bg-plum-600'
                      : 'bg-slate-300',
                )}
              />
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
