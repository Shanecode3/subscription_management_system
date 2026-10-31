import { cx } from '../../lib/cx';

/**
 * Wordmark used in the header and on the auth panel. The mark is drawn with
 * Tailwind only, so there is no image request and it stays crisp at any size.
 */
export function BrandMark({
  size = 'md',
  tone = 'dark',
  compact = false,
}: {
  size?: 'sm' | 'md';
  tone?: 'dark' | 'light';
  /** On narrow headers, keep the mark and drop the wordmark so it cannot collide. */
  compact?: boolean;
}) {
  const box = size === 'sm' ? 'h-8 w-8 text-sm' : 'h-10 w-10 text-base';

  return (
    <div className="flex items-center gap-2.5">
      <div
        className={cx(
          'flex items-center justify-center rounded-lg bg-gradient-to-br from-plum-500 to-plum-700 font-bold text-white shadow-sm',
          box,
        )}
        aria-hidden="true"
      >
        B
      </div>
      <div className={cx('leading-tight', compact && 'hidden sm:block')}>
        <p
          className={cx(
            'font-semibold tracking-tight',
            size === 'sm' ? 'text-sm' : 'text-base',
            tone === 'light' ? 'text-white' : 'text-ink',
          )}
        >
          Brightloop
        </p>
        <p
          className={cx(
            'text-[11px] uppercase tracking-[0.14em]',
            tone === 'light' ? 'text-white/60' : 'text-slate-500',
          )}
        >
          Subscription Suite
        </p>
      </div>
    </div>
  );
}
