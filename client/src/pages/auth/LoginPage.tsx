import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../../components/layout/AuthLayout';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../../lib/demo-accounts';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/';

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    if (!email.trim() || !password) {
      setFormError('Enter your email address and password to continue.');
      return;
    }

    setIsSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate(redirectTo, { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.message);
        setFieldErrors(error.fieldErrors());
      } else {
        setFormError('Something went wrong while signing in. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const useDemoAccount = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword(DEMO_PASSWORD);
    setFormError(null);
    setFieldErrors({});
  };

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Access your Brightloop workspace."
      footer={
        <>
          New customer?{' '}
          <Link to="/signup" className="font-semibold text-plum-700 hover:text-plum-800">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {formError ? <Alert tone="error">{formError}</Alert> : null}

        <TextField
          id="email"
          label="Email address"
          type="email"
          autoComplete="email"
          placeholder="name@company.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldErrors.email}
          required
        />

        <div>
          <TextField
            id="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={fieldErrors.password}
            required
          />
          <div className="mt-2 text-right">
            <Link
              to="/forgot-password"
              className="text-xs font-medium text-teal-700 hover:text-teal-800"
            >
              Forgot password?
            </Link>
          </div>
        </div>

        <Button type="submit" isLoading={isSubmitting}>
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <div className="mt-6 border-t border-slate-200 pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Demo accounts
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Tap a role to fill the form. Shared password:{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-ink">
            {DEMO_PASSWORD}
          </code>
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.role}
              type="button"
              onClick={() => useDemoAccount(account.email)}
              className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-ink transition-colors hover:border-plum-300 hover:bg-plum-50"
            >
              {account.label}
            </button>
          ))}
        </div>
      </div>
    </AuthLayout>
  );
}
