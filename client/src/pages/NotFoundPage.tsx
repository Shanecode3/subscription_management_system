import { Link } from 'react-router-dom';
import { BrandMark } from '../components/ui/BrandMark';

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-surface px-6 text-center">
      <BrandMark />
      <div>
        <p className="text-sm font-semibold uppercase tracking-widest text-slate-400">Error 404</p>
        <h1 className="mt-2 text-2xl font-semibold text-ink">This page does not exist</h1>
        <p className="mt-1.5 text-sm text-slate-600">
          The link may be out of date. Head back to your workspace to continue.
        </p>
      </div>
      <Link to="/" className="btn-primary w-auto px-6">
        Back to dashboard
      </Link>
    </div>
  );
}
